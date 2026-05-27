import { randomUUID } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
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
    const beforeStatus = event.data?.before.exists
      ? (event.data.before.data() as EditionRecord).status
      : undefined;

    if (
      edition.status !== "processing" ||
      beforeStatus === "processing" ||
      !edition.publisherId ||
      !edition.sourceAssetPath
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
        ? await renderPdfPages(sourceBuffer, edition)
        : await normalizeImagePage(sourceBuffer, edition);
      const pagesWithBlocks = [];

      for (const page of pages) {
        const pageImage = await uploadPageImage(edition, page);
        const suggestedBlocks = await detectBlocks(page, openAiApiKey.value());

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
): Promise<PageAssetResult[]> {
  const image = sharp(sourceBuffer).rotate().resize({ width: 1800, withoutEnlargement: true });
  const metadata = await image.metadata();
  const imageBuffer = await image.png().toBuffer();

  return [
    {
      pageId: `${edition.id}-p1`,
      pageNumber: 1,
      section: edition.sections?.[0] ?? "मुख पृष्ठ",
      imageBuffer,
      width: metadata.width ?? 1200,
      height: metadata.height ?? 1800,
    },
  ];
}

async function renderPdfPages(
  sourceBuffer: Buffer,
  edition: EditionRecord,
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

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const pdfPage = await document.getPage(pageNumber);
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
