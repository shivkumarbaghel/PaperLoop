import { randomUUID } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import OpenAI from "openai";
import sharp from "sharp";

initializeApp();

const openAiApiKey = defineSecret("OPENAI_API_KEY");
const db = getFirestore();
const bucket = getStorage().bucket();
const maxPdfPages = Number(process.env.PAPERLOOP_MAX_PROCESSING_PAGES ?? 12);
const blockModel = process.env.OPENAI_BLOCK_MODEL ?? "gpt-5.4-mini";

interface EditionRecord {
  id: string;
  publisherId: string;
  title: string;
  date: string;
  city: string;
  sections?: string[];
  status: "draft" | "processing" | "review" | "published" | "archived" | "failed";
  sourceAssetPath?: string;
  sourceAssetType?: string;
  pages?: Array<{
    id: string;
    pageNumber: number;
    section: string;
    headline: string;
    subhead: string;
    imageUrl?: string;
    thumbnailUrl?: string;
    width?: number;
    height?: number;
    processingStatus?: string;
    hotspots?: unknown[];
  }>;
}

interface AppendEditionPagesInput {
  publisherId: string;
  editionId: string;
  sourceAssetPath: string;
  contentType: string;
}

interface PageAssetResult {
  pageId: string;
  pageNumber: number;
  section: string;
  imageBuffer: Buffer;
  width: number;
  height: number;
}

interface SuggestedBlock {
  type: "article" | "advertisement" | "photo" | "notice" | "other";
  label: string;
  title: string;
  section: string;
  summary: string;
  body: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

interface ClipRegionInput {
  publisherId: string;
  editionId: string;
  pageId: string;
  pageNumber: number;
  pageSection: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ExtractedClipDetails {
  type: SuggestedBlock["type"];
  label: string;
  title: string;
  section: string;
  summary: string;
  body: string;
  confidence: number;
  previewDataUrl: string;
}

export const extractClipRegionDetails = onCall(
  {
    region: "asia-south1",
    timeoutSeconds: 120,
    memory: "1GiB",
    secrets: [openAiApiKey],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in to extract clip details.");
    }

    const input = request.data as ClipRegionInput;

    if (
      !input?.publisherId ||
      !input.editionId ||
      !input.pageId ||
      !Number.isFinite(input.pageNumber) ||
      input.pageNumber < 1
    ) {
      throw new HttpsError("invalid-argument", "Publisher, edition, and page are required.");
    }

    await assertPublisherAccess(request.auth.uid, input.publisherId);

    const geometry = normalizeGeometry(input);
    const pagePath = `publishers/${input.publisherId}/editions/${input.editionId}/pages/page-${input.pageNumber}.png`;

    let pageBuffer: Buffer;

    try {
      [pageBuffer] = await bucket.file(pagePath).download();
    } catch {
      throw new HttpsError("not-found", "Processed page image was not found for this clip.");
    }

    const croppedWebp = await cropPageRegion(pageBuffer, geometry);
    const pageSection = input.pageSection?.trim() || "General";
    const details = await extractDetailsFromCrop(
      croppedWebp,
      pageSection,
      openAiApiKey.value(),
    );

    return {
      ...details,
      previewDataUrl: `data:image/webp;base64,${croppedWebp.toString("base64")}`,
    } satisfies ExtractedClipDetails;
  },
);

export const appendEditionPages = onCall(
  {
    region: "asia-south1",
    timeoutSeconds: 540,
    memory: "2GiB",
    secrets: [openAiApiKey],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in to add pages to an edition.");
    }

    const input = request.data as AppendEditionPagesInput;

    if (
      !input?.publisherId ||
      !input.editionId ||
      !input.sourceAssetPath ||
      !input.contentType
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Publisher, edition, source asset path, and content type are required.",
      );
    }

    await assertPublisherAccess(request.auth.uid, input.publisherId);

    const editionRef = db.collection("editions").doc(input.editionId);
    const editionSnapshot = await editionRef.get();

    if (!editionSnapshot.exists) {
      throw new HttpsError("not-found", "Edition not found.");
    }

    const edition = {
      id: editionSnapshot.id,
      ...editionSnapshot.data(),
    } as EditionRecord;

    if (edition.publisherId !== input.publisherId) {
      throw new HttpsError("permission-denied", "Edition publisher mismatch.");
    }

    const existingPages = edition.pages ?? [];
    const startPageNumber = nextEditionPageNumber(existingPages);
    const [sourceBuffer] = await bucket.file(input.sourceAssetPath).download();
    const pageAssets =
      input.contentType === "application/pdf"
        ? await renderPdfPages(sourceBuffer, edition, startPageNumber)
        : await normalizeImagePage(sourceBuffer, edition, startPageNumber);
    const appendedPages = [];

    for (const page of pageAssets) {
      const pageImage = await uploadPageImage(edition, page);
      const suggestedBlockCount = await persistSuggestedBlocks(
        edition,
        page,
        openAiApiKey.value(),
      );

      appendedPages.push({
        id: page.pageId,
        editionId: edition.id,
        pageNumber: page.pageNumber,
        section: page.section,
        headline: `${page.section} page`,
        subhead: `${edition.city} edition • ${edition.date}`,
        imageUrl: pageImage.imageUrl,
        thumbnailUrl: pageImage.thumbnailUrl,
        width: pageImage.width,
        height: pageImage.height,
        processingStatus: "ready",
        hotspots: [],
      });

      logger.info("Appended edition page with suggested blocks", {
        editionId: edition.id,
        pageId: page.pageId,
        suggestedBlockCount,
      });
    }

    await editionRef.update({
      pages: [...existingPages, ...appendedPages],
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      addedPageCount: appendedPages.length,
      pages: appendedPages,
    };
  },
);

export const processEditionAsset = onDocumentWritten(
  {
    document: "editions/{editionId}",
    region: "asia-south1",
    timeoutSeconds: 540,
    memory: "2GiB",
    secrets: [openAiApiKey],
  },
  async (event) => {
    const after = event.data?.after;

    if (!after?.exists) {
      return;
    }

    const edition = {
      id: after.id,
      ...after.data(),
    } as EditionRecord;
    const beforeData = event.data?.before.exists ? event.data.before.data() : undefined;
    const beforeStatus = beforeData?.status as EditionRecord["status"] | undefined;
    const beforeQueueToken = processingQueueToken(beforeData?.processingQueuedAt);
    const afterQueueToken = processingQueueToken(after.data()?.processingQueuedAt);

    if (
      edition.status !== "processing" ||
      !edition.publisherId ||
      !edition.sourceAssetPath ||
      (beforeStatus === "processing" && beforeQueueToken === afterQueueToken)
    ) {
      return;
    }

    const jobRef = db.collection("processingJobs").doc(edition.id);

    await jobRef.set(
      {
        id: edition.id,
        publisherId: edition.publisherId,
        editionId: edition.id,
        sourceAssetPath: edition.sourceAssetPath,
        status: "processing",
        pageCount: 0,
        startedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    try {
      const [sourceBuffer] = await bucket.file(edition.sourceAssetPath).download();
      const pages = edition.sourceAssetType === "application/pdf"
        ? await renderPdfPages(sourceBuffer, edition, 1)
        : await normalizeImagePage(sourceBuffer, edition, 1);
      const pagesWithBlocks = [];

      for (const page of pages) {
        const pageImage = await uploadPageImage(edition, page);
        await persistSuggestedBlocks(edition, page, openAiApiKey.value());

        pagesWithBlocks.push({
          id: page.pageId,
          editionId: edition.id,
          pageNumber: page.pageNumber,
          section: page.section,
          headline: page.pageNumber === 1 ? edition.title : `${page.section} page`,
          subhead: `${edition.city} edition • ${edition.date}`,
          imageUrl: pageImage.imageUrl,
          thumbnailUrl: pageImage.thumbnailUrl,
          width: pageImage.width,
          height: pageImage.height,
          processingStatus: "ready",
          hotspots: [],
        });
      }

      await after.ref.update({
        pages: pagesWithBlocks,
        status: "review",
        processingError: FieldValue.delete(),
        processedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await jobRef.set(
        {
          status: "review",
          pageCount: pagesWithBlocks.length,
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown processing error.";

      logger.error("PaperLoop edition processing failed", { editionId: edition.id, message });
      await after.ref.update({
        status: "failed",
        processingError: message,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await jobRef.set(
        {
          status: "failed",
          error: message,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  },
);

async function normalizeImagePage(
  sourceBuffer: Buffer,
  edition: EditionRecord,
  startPageNumber = 1,
): Promise<PageAssetResult[]> {
  const image = sharp(sourceBuffer).rotate().resize({ width: 1800, withoutEnlargement: true });
  const metadata = await image.metadata();
  const imageBuffer = await image.png().toBuffer();

  return [
    {
      pageId: `${edition.id}-p${startPageNumber}`,
      pageNumber: startPageNumber,
      section: edition.sections?.[startPageNumber - 1] ?? "मुख पृष्ठ",
      imageBuffer,
      width: metadata.width ?? 1200,
      height: metadata.height ?? 1800,
    },
  ];
}

async function renderPdfPages(
  sourceBuffer: Buffer,
  edition: EditionRecord,
  startPageNumber = 1,
): Promise<PageAssetResult[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const canvasModule = await import("@napi-rs/canvas");
  const documentTask = pdfjs.getDocument({
    data: new Uint8Array(sourceBuffer),
    disableWorker: true,
    useSystemFonts: true,
  } as never);
  const document = await documentTask.promise;
  const pageCount = Math.min(document.numPages, maxPdfPages);
  const pages: PageAssetResult[] = [];

  for (let pdfPageIndex = 1; pdfPageIndex <= pageCount; pdfPageIndex += 1) {
    const pageNumber = startPageNumber + pdfPageIndex - 1;
    const pdfPage = await document.getPage(pdfPageIndex);
    const viewport = pdfPage.getViewport({ scale: 2 });
    const canvas = canvasModule.createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    const canvasContext = canvas.getContext("2d");

    await pdfPage.render({ canvas, canvasContext, viewport } as never).promise;

    const imageBuffer =
      typeof (canvas as { toBuffer?: (mimeType: string) => Buffer }).toBuffer === "function"
        ? (canvas as { toBuffer: (mimeType: string) => Buffer }).toBuffer("image/png")
        : Buffer.from(await (canvas as { encode: (format: string) => Promise<Uint8Array> }).encode("png"));

    pages.push({
      pageId: `${edition.id}-p${pageNumber}`,
      pageNumber,
      section: edition.sections?.[pageNumber - 1] ?? `Page ${pageNumber}`,
      imageBuffer,
      width: Math.ceil(viewport.width),
      height: Math.ceil(viewport.height),
    });
  }

  return pages;
}

async function uploadPageImage(edition: EditionRecord, page: PageAssetResult) {
  const imagePath = `publishers/${edition.publisherId}/editions/${edition.id}/pages/page-${page.pageNumber}.png`;
  const thumbnailPath = `publishers/${edition.publisherId}/editions/${edition.id}/thumbnails/page-${page.pageNumber}.webp`;
  const thumbnail = await sharp(page.imageBuffer)
    .resize({ width: 360, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  const imageUrl = await saveDownloadableFile(imagePath, page.imageBuffer, "image/png");
  const thumbnailUrl = await saveDownloadableFile(thumbnailPath, thumbnail, "image/webp");

  await db.collection("pageAssets").doc(page.pageId).set(
    {
      id: page.pageId,
      publisherId: edition.publisherId,
      editionId: edition.id,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      imageUrl,
      thumbnailUrl,
      storagePath: imagePath,
      thumbnailPath,
      width: page.width,
      height: page.height,
      status: "ready",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    imageUrl,
    thumbnailUrl,
    width: page.width,
    height: page.height,
  };
}

async function saveDownloadableFile(path: string, buffer: Buffer, contentType: string) {
  const token = randomUUID();

  await bucket.file(path).save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
  });

  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

async function persistSuggestedBlocks(
  edition: EditionRecord,
  page: PageAssetResult,
  apiKey: string,
) {
  const suggestedBlocks = await detectBlocks(page, apiKey);

  await Promise.all(
    suggestedBlocks.map((block, index) =>
      db.collection("articleBlocks").doc(`${page.pageId}-ai-${index + 1}`).set(
        {
          id: `${page.pageId}-ai-${index + 1}`,
          publisherId: edition.publisherId,
          editionId: edition.id,
          pageId: page.pageId,
          pageNumber: page.pageNumber,
          type: block.type,
          status: "suggested",
          source: "ai",
          label: block.label,
          title: block.title,
          section: block.section || page.section,
          summary: block.summary,
          body: block.body,
          x: block.x,
          y: block.y,
          width: block.width,
          height: block.height,
          confidence: block.confidence,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      ),
    ),
  );

  return suggestedBlocks.length;
}

function processingQueueToken(value: unknown) {
  if (value && typeof value === "object" && "toMillis" in value) {
    return String((value as { toMillis: () => number }).toMillis());
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return "";
}

async function detectBlocks(
  page: PageAssetResult,
  apiKey: string,
): Promise<SuggestedBlock[]> {
  if (!apiKey) {
    return fallbackBlocks(page);
  }

  const openai = new OpenAI({ apiKey });
  const dataUrl = `data:image/png;base64,${page.imageBuffer.toString("base64")}`;

  try {
    const response = await openai.responses.create({
      model: blockModel,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Identify newspaper article and advertisement blocks in this Hindi e-paper page.",
                "Return normalized percentage coordinates relative to the page image.",
                "Coordinates must use 0-100 percentages, and every block must satisfy x + width <= 100 and y + height <= 100.",
                "Draw tight rectangles around complete story or ad units only; do not include mastheads, page margins, crop marks, color bars, or unrelated neighboring stories.",
                "Prefer several precise blocks over one large mixed block, and avoid overlaps unless the printed page genuinely overlaps content.",
                "Keep body text short; editors will correct OCR manually.",
              ].join(" "),
            },
            {
              type: "input_image",
              image_url: dataUrl,
              detail: "high",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "paperloop_page_blocks",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["blocks"],
            properties: {
              blocks: {
                type: "array",
                maxItems: 12,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "type",
                    "label",
                    "title",
                    "section",
                    "summary",
                    "body",
                    "x",
                    "y",
                    "width",
                    "height",
                    "confidence",
                  ],
                  properties: {
                    type: {
                      type: "string",
                      enum: ["article", "advertisement", "photo", "notice", "other"],
                    },
                    label: { type: "string" },
                    title: { type: "string" },
                    section: { type: "string" },
                    summary: { type: "string" },
                    body: { type: "string" },
                    x: { type: "number" },
                    y: { type: "number" },
                    width: { type: "number" },
                    height: { type: "number" },
                    confidence: { type: "number" },
                  },
                },
              },
            },
          },
        },
      },
    } as never);
    const outputText = (response as { output_text?: string }).output_text ?? "";
    const parsed = JSON.parse(outputText) as { blocks?: SuggestedBlock[] };

    return normalizeBlocks(parsed.blocks ?? [], page);
  } catch (error) {
    logger.warn("OpenAI block detection fell back to template blocks", {
      pageId: page.pageId,
      error: error instanceof Error ? error.message : "unknown",
    });

    return fallbackBlocks(page);
  }
}

function normalizeBlocks(blocks: SuggestedBlock[], page: PageAssetResult) {
  const normalized = blocks
    .filter((block) => block.width > 0 && block.height > 0)
    .map((block, index) => {
      const geometry = normalizeGeometry(block);

      return {
        type: block.type,
        label: block.label || `Block ${index + 1}`,
        title: block.title || `${page.section} story ${index + 1}`,
        section: block.section || page.section,
        summary: block.summary || "AI suggested article block. Review before publishing.",
        body: block.body || "OCR draft requires editor review.",
        ...geometry,
        confidence: Math.max(0, Math.min(1, block.confidence || 0.5)),
      };
    });

  return normalized.length ? normalized : fallbackBlocks(page);
}

function fallbackBlocks(page: PageAssetResult): SuggestedBlock[] {
  return [
    {
      type: "article",
      label: "Lead story",
      title: page.pageNumber === 1 ? "Lead story from uploaded page" : `${page.section} story`,
      section: page.section,
      summary: "Suggested article area. Review OCR and clipping before publishing.",
      body: "AI/OCR draft text will be corrected by publisher staff before publishing.",
      x: 8,
      y: 15,
      width: 54,
      height: 26,
      confidence: 0.55,
    },
    {
      type: "advertisement",
      label: "Advertisement",
      title: "Detected ad placement",
      section: page.section,
      summary: "Suggested advertisement block for campaign placement.",
      body: "",
      x: 62,
      y: 58,
      width: 30,
      height: 25,
      confidence: 0.5,
    },
  ];
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function normalizeGeometry(block: Pick<SuggestedBlock, "x" | "y" | "width" | "height">) {
  const x = Math.min(99, clampPercent(block.x));
  const y = Math.min(99, clampPercent(block.y));
  const width = Math.max(1, Math.min(clampPercent(block.width), 100 - x));
  const height = Math.max(1, Math.min(clampPercent(block.height), 100 - y));

  return { x, y, width, height };
}

async function assertPublisherAccess(uid: string, publisherId: string) {
  const staffSnapshot = await db
    .collection("publisherStaff")
    .doc(`${publisherId}_${uid}`)
    .get();

  if (staffSnapshot.exists && staffSnapshot.data()?.status === "active") {
    return;
  }

  const userSnapshot = await db.collection("users").doc(uid).get();
  const role = userSnapshot.data()?.role;

  if (role === "platform_admin" || role === "super_admin") {
    return;
  }

  throw new HttpsError(
    "permission-denied",
    "This account cannot extract clip details for that publisher.",
  );
}

function nextEditionPageNumber(
  pages: Array<{ pageNumber: number }>,
) {
  if (!pages.length) {
    return 1;
  }

  return Math.max(...pages.map((page) => page.pageNumber)) + 1;
}

async function cropPageRegion(
  imageBuffer: Buffer,
  geometry: Pick<SuggestedBlock, "x" | "y" | "width" | "height">,
) {
  const metadata = await sharp(imageBuffer).metadata();
  const imageWidth = metadata.width ?? 1200;
  const imageHeight = metadata.height ?? 1800;
  const crop = normalizeGeometry(geometry);
  const left = Math.floor((crop.x / 100) * imageWidth);
  const top = Math.floor((crop.y / 100) * imageHeight);
  const width = Math.min(
    Math.max(1, Math.round((crop.width / 100) * imageWidth)),
    imageWidth - left,
  );
  const height = Math.min(
    Math.max(1, Math.round((crop.height / 100) * imageHeight)),
    imageHeight - top,
  );

  return sharp(imageBuffer)
    .extract({ left, top, width, height })
    .webp({ quality: 86 })
    .toBuffer();
}

async function extractDetailsFromCrop(
  croppedWebp: Buffer,
  pageSection: string,
  apiKey: string,
): Promise<Omit<ExtractedClipDetails, "previewDataUrl">> {
  if (!apiKey) {
    return fallbackClipDetails(pageSection);
  }

  const openai = new OpenAI({ apiKey });
  const dataUrl = `data:image/webp;base64,${croppedWebp.toString("base64")}`;

  try {
    const response = await openai.responses.create({
      model: blockModel,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Read this cropped Hindi/English newspaper clip.",
                "Extract editorial metadata for a publisher workflow.",
                "Return a concise hotspot label (3-6 words), headline title, section name, short summary, and brief OCR body text.",
                `Default section hint: ${pageSection}.`,
              ].join(" "),
            },
            {
              type: "input_image",
              image_url: dataUrl,
              detail: "high",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "paperloop_clip_details",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["type", "label", "title", "section", "summary", "body", "confidence"],
            properties: {
              type: {
                type: "string",
                enum: ["article", "advertisement", "photo", "notice", "other"],
              },
              label: { type: "string" },
              title: { type: "string" },
              section: { type: "string" },
              summary: { type: "string" },
              body: { type: "string" },
              confidence: { type: "number" },
            },
          },
        },
      },
    } as never);
    const outputText = (response as { output_text?: string }).output_text ?? "";
    const parsed = JSON.parse(outputText) as Partial<ExtractedClipDetails>;

    return {
      type: parsed.type ?? "article",
      label: parsed.label?.trim() || "Clip story",
      title: parsed.title?.trim() || `${pageSection} story`,
      section: parsed.section?.trim() || pageSection,
      summary:
        parsed.summary?.trim() ||
        "AI extracted summary from the selected clip. Review before publishing.",
      body:
        parsed.body?.trim() ||
        "AI OCR draft from the selected clip. Editors should verify before publishing.",
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.65)),
    };
  } catch (error) {
    logger.warn("Clip detail extraction fell back to defaults", {
      pageSection,
      error: error instanceof Error ? error.message : "unknown",
    });

    return fallbackClipDetails(pageSection);
  }
}

function fallbackClipDetails(pageSection: string): Omit<ExtractedClipDetails, "previewDataUrl"> {
  return {
    type: "article",
    label: "Clip story",
    title: `${pageSection} story`,
    section: pageSection,
    summary: "Clip region saved. Add or correct extracted text before publishing.",
    body: "OCR draft will appear here after smart extraction. Review manually if needed.",
    confidence: 0.45,
  };
}
