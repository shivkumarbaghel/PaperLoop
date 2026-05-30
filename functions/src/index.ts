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
const blockModel = process.env.OPENAI_BLOCK_MODEL ?? "gpt-4o";

interface EditionRecord {
  id: string;
  publisherId: string;
  title: string;
  date: string;
  city: string;
  language?: string;
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
  editionCity?: string;
  editionState?: string;
  editionLanguage?: string;
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
  area: string;
  tags: string[];
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
      {
        editionCity: input.editionCity?.trim() || "",
        editionState: input.editionState?.trim() || "",
        editionLanguage: input.editionLanguage?.trim() || "",
      },
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
  const suggestedBlocks = await detectBlocks(page, apiKey, edition.language);

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
  language?: string,
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
              text: buildBlockDetectionPrompt(language),
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
                maxItems: 25,
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

/**
 * Maps a publisher-selected language name (e.g. "Hindi", "Tamil", "Urdu") to
 * a short description of the script and any special considerations, suitable
 * for inclusion in an AI prompt.
 */
function languagePromptHint(language?: string): string {
  const lang = (language ?? "").trim();

  if (!lang) {
    return "The newspaper language is unknown. It may be in Hindi (Devanagari), English, or another Indian language.";
  }

  const scriptMap: Record<string, { script: string; note?: string }> = {
    Hindi: { script: "Devanagari" },
    Marathi: { script: "Devanagari" },
    Sanskrit: { script: "Devanagari" },
    Gujarati: { script: "Gujarati" },
    Bengali: { script: "Bengali" },
    Assamese: { script: "Bengali/Assamese" },
    Tamil: { script: "Tamil" },
    Telugu: { script: "Telugu" },
    Kannada: { script: "Kannada" },
    Malayalam: { script: "Malayalam" },
    Punjabi: { script: "Gurmukhi" },
    Odia: { script: "Odia" },
    Urdu: { script: "Nastaliq", note: "Text runs right-to-left." },
    English: { script: "Latin" },
  };

  const info = scriptMap[lang];

  if (!info) {
    return `The newspaper is in ${lang}. Transcribe body text faithfully in the original script.`;
  }

  const parts = [
    `The newspaper is in ${lang} (${info.script} script).`,
    `Transcribe body text in ${lang} Unicode — do NOT transliterate or translate.`,
    "English words or acronyms that appear within the text should be kept in Latin script as printed.",
  ];

  if (info.note) {
    parts.push(info.note);
  }

  return parts.join(" ");
}

function buildBlockDetectionPrompt(language?: string): string {
  return [
    "You are an expert newspaper layout analyst specializing in Indian regional e-papers.",
    "Your task: identify ALL distinct editorial blocks on the page image and return their bounding boxes.",
    "",
    "=== LANGUAGE ===",
    languagePromptHint(language),
    "",
    "=== STEP-BY-STEP APPROACH (follow this order) ===",
    "1. SCAN THE PAGE STRUCTURE: Identify the column grid (typically 5–8 vertical columns in Indian dailies).",
    "   Note where column rules (thin vertical lines) divide the page.",
    "2. IDENTIFY BLOCK BOUNDARIES: Each editorial block occupies one or more complete columns.",
    "   Horizontal rules, white gaps, or changes in font/background mark the top and bottom of each block.",
    "3. MAP EVERY BLOCK: Working top-to-bottom, left-to-right, assign a bounding box to every distinct unit.",
    "4. CHECK FOR OVERLAPS: Before finalising, verify that no two bounding boxes intersect.",
    "   Adjust edges so adjacent blocks share a boundary without crossing.",
    "",
    "=== WHAT TO DETECT ===",
    "Detect every: news article (any size), advertisement, standalone photograph with caption, boxed notice, editorial/opinion box.",
    "Each block = exactly ONE self-contained editorial unit.",
    "",
    "=== WHAT TO SKIP ===",
    "SKIP: masthead/nameplate, page number, publication date line, column rules, page margins, crop/registration marks, colour calibration bars.",
    "These are decorative and must NOT become blocks.",
    "",
    "=== BOUNDING BOX RULES (NON-NEGOTIABLE) ===",
    "• Coordinates are PERCENTAGE values 0–100, relative to the full page image (width and height).",
    "• Constraint: x + width ≤ 100 AND y + height ≤ 100 for every block.",
    "• Draw the TIGHTEST rectangle that fully encloses the content — trim margins and whitespace.",
    "• ZERO OVERLAP: no two blocks may share any pixel area.",
    "  If two blocks share a printed column rule, butt their edges to the rule centre-line.",
    "• NEVER create a large 'container' block that wraps smaller blocks inside it.",
    "• Minimum size: width ≥ 3% AND height ≥ 2%.",
    "",
    "=== NON-RECTANGULAR CONTENT ===",
    "When an article wraps around an advertisement (L-shape or U-shape):",
    "  • Split the article into 2–3 non-overlapping rectangles that together cover its full text area.",
    "  • Give each part the same label with a suffix: 'Lead story – part 1', 'Lead story – part 2'.",
    "  • Each part is its own separate block entry.",
    "",
    "=== COVERAGE GOAL ===",
    "Every text-filled area on the page must belong to exactly one block.",
    "Large un-covered text regions are mistakes — add a block for them, even if you're uncertain (confidence 0.4).",
    "",
    "=== CONFIDENCE SCORING ===",
    "0.9–1.0: perfectly visible block boundary, no ambiguity.",
    "0.7–0.89: boundary is clear but minor uncertainty on one edge.",
    "0.5–0.69: block likely correct but one or more edges are estimated.",
    "0.3–0.49: heavily uncertain — block may be wrong.",
    "",
    "Output blocks sorted top-to-bottom, left-to-right (reading order).",
    "Keep body text to 1–3 sentences — editors will review OCR manually.",
  ].join("\n");
}

function buildClipExtractionPrompt(
  pageSection: string,
  localeHint: string,
  language?: string,
): string {
  return [
    "You are an expert newspaper editor and OCR specialist for a regional e-paper platform.",
    "You have been given a CROPPED region of a newspaper page that a publisher selected manually.",
    "Your job is to extract clean editorial metadata to pre-fill the publisher's article creation form.",
    "",
    "=== LANGUAGE & SCRIPT ===",
    languagePromptHint(language),
    "",
    "=== CONTENT TYPE ===",
    "Identify the content type first — this controls how other fields are extracted:",
    "• 'article'  — news story, feature, opinion, interview (most common)",
    "• 'advertisement' — paid promotional content (look for: price lists, brand logos, taglines, 'विज्ञापन', 'Advt.')",
    "• 'photo'    — standalone photograph with or without a caption",
    "• 'notice'   — government notice, tender, exam result, obituary, legal notice",
    "• 'other'    — anything not covered above (e.g. TV schedule, weather table)",
    "",
    "=== HEADLINE (title field) ===",
    "• The headline is almost always the LARGEST or BOLDEST text, typically at the top of the clip.",
    "• If there is both a kicker/deck line and a main headline, extract the MAIN headline.",
    "• Transcribe the headline faithfully in the script it is printed — do NOT translate or transliterate.",
    "• If no clear headline is visible (e.g. advertisement or photo), write a short descriptive title instead.",
    "",
    "=== LABEL (label field) ===",
    "• A short UI chip label for the studio sidebar: 3–6 words maximum.",
    "• Capture the TOPIC of the story, NOT the headline verbatim.",
    "• Always write in English for easy scanning — even if the article is in a non-Latin script.",
    "• Good examples: 'PM Modi budget speech', 'Road accident Kanpur', 'IPL final result', 'Flood relief UP'",
    "• Bad examples: (headline verbatim in any script), 'Article about news', 'Story 1'",
    "",
    "=== SECTION ===",
    `• Default section from the page: '${pageSection}'.`,
    "• Use this default UNLESS the clip itself has a visible section flag/header that clearly names a different section",
    "  (e.g., 'खेल', 'Sports', 'Business', 'Crime', 'Health', 'Entertainment', 'व्यापार', 'ক্রীড়া').",
    "• Do NOT invent or guess a section — if in doubt, return the default.",
    "",
    "=== SUMMARY ===",
    "• 1–3 English sentences that clearly describe what this piece is about.",
    "• For advertisements: describe the product/brand and the offer or call-to-action.",
    "• For notices: describe the subject (e.g., 'Tender notice for road construction project in Lucknow issued by PWD.').",
    "• For photos: describe what/who is shown and why it is newsworthy.",
    "",
    "=== BODY (OCR body text) ===",
    "• Transcribe the main article body text as accurately as possible in the original script (per the LANGUAGE section above).",
    "• Limit to approximately 300 words — editors will correct and expand the text manually.",
    "• Skip: standalone photo captions that are separate from the article body, advertisement price lists,",
    "  phone/contact numbers (unless they are part of a notice), page folios.",
    "• For advertisements, transcribe only the main ad copy — omit fine-print legal disclaimers.",
    "",
    "=== AREA (locality) ===",
    localeHint
      ? `• Edition locale context (city/state — do NOT use this as the area value): ${localeHint}.`
      : "• No edition locale hint was provided.",
    "• Set area to the SPECIFIC locality, neighborhood, district, tehsil, or smaller town explicitly named in the clip text.",
    "• It must be MORE SPECIFIC than the edition city — e.g., 'Gomti Nagar', 'Hazratganj', 'Varanasi Cantonment', 'Noida Sector 18'.",
    "• If no specific sub-city locality is mentioned in the text, return empty string ''.",
    "",
    "=== TAGS ===",
    "• Return 3–6 specific, searchable tags (English preferred).",
    "• Tags should be SPECIFIC (e.g., 'flood relief', 'budget 2025', 'road accident', 'election results')",
    "  NOT generic (e.g., 'news', 'article', 'Hindi', 'newspaper').",
    "• Suggested mix: 1–2 topic/event tags + 1 location tag if the clip names a place + 1 person/org tag if prominent.",
    "",
    "=== CONFIDENCE ===",
    "• 0.85–1.0: image is crisp, headline and body text are clearly readable.",
    "• 0.6–0.84: some text is blurry, small, or partially cut off but the main content is understood.",
    "• 0.3–0.59: heavily degraded scan, rotated/skewed text, or the selection missed most of the content.",
  ].join("\n");
}

/**
 * Compute Intersection-over-Union for two blocks (percentage coordinate space).
 * Returns a value in [0, 1]; 0 = no overlap, 1 = identical.
 */
function computeIoU(a: SuggestedBlock, b: SuggestedBlock): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;

  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const intersection = ix * iy;

  if (intersection === 0) return 0;

  const union = a.width * a.height + b.width * b.height - intersection;

  return union > 0 ? intersection / union : 0;
}

/**
 * Non-maximum suppression: given a list of blocks sorted by descending confidence,
 * drop any block whose IoU with an already-kept block exceeds `iouThreshold`.
 * This removes redundant / duplicate overlapping detections while preserving the
 * highest-confidence block in each overlapping cluster.
 */
function suppressOverlaps(blocks: SuggestedBlock[], iouThreshold = 0.12): SuggestedBlock[] {
  const sorted = [...blocks].sort((a, b) => b.confidence - a.confidence);
  const kept: SuggestedBlock[] = [];

  for (const block of sorted) {
    const overlaps = kept.some((k) => computeIoU(block, k) > iouThreshold);

    if (!overlaps) {
      kept.push(block);
    }
  }

  // Restore reading-order sort (top-to-bottom, left-to-right) after NMS
  return kept.sort((a, b) => {
    const rowDiff = a.y - b.y;

    return Math.abs(rowDiff) > 3 ? rowDiff : a.x - b.x;
  });
}

function normalizeBlocks(blocks: SuggestedBlock[], page: PageAssetResult) {
  const normalized = blocks
    // Drop zero-size or impossibly tiny blocks (< 1% × 1%)
    .filter((block) => block.width >= 1 && block.height >= 1)
    // Drop very low-confidence noise detections
    .filter((block) => (block.confidence ?? 1) >= 0.3)
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

  const deduped = suppressOverlaps(normalized);

  return deduped.length ? deduped : fallbackBlocks(page);
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
    .webp({ quality: 92 })
    .toBuffer();
}

async function extractDetailsFromCrop(
  croppedWebp: Buffer,
  pageSection: string,
  apiKey: string,
  editionLocale: { editionCity: string; editionState: string; editionLanguage?: string } = {
    editionCity: "",
    editionState: "",
    editionLanguage: "",
  },
): Promise<Omit<ExtractedClipDetails, "previewDataUrl">> {
  if (!apiKey) {
    return fallbackClipDetails(pageSection, editionLocale);
  }

  const openai = new OpenAI({ apiKey });
  const dataUrl = `data:image/webp;base64,${croppedWebp.toString("base64")}`;
  const localeHint = [editionLocale.editionCity, editionLocale.editionState]
    .filter(Boolean)
    .join(", ");

  try {
    const response = await openai.responses.create({
      model: blockModel,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildClipExtractionPrompt(
                pageSection,
                localeHint,
                editionLocale.editionLanguage,
              ),
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
            required: [
              "type",
              "label",
              "title",
              "section",
              "summary",
              "body",
              "area",
              "tags",
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
              area: { type: "string" },
              tags: {
                type: "array",
                items: { type: "string" },
                maxItems: 8,
              },
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
      area: parsed.area?.trim() || "",
      tags: normalizeTags(parsed.tags),
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.65)),
    };
  } catch (error) {
    logger.warn("Clip detail extraction fell back to defaults", {
      pageSection,
      error: error instanceof Error ? error.message : "unknown",
    });

    return fallbackClipDetails(pageSection, editionLocale);
  }
}

function normalizeTags(tags: unknown) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function fallbackClipDetails(
  pageSection: string,
  editionLocale: { editionCity: string; editionState: string },
): Omit<ExtractedClipDetails, "previewDataUrl"> {
  const tags = [pageSection, editionLocale.editionCity, editionLocale.editionState]
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    type: "article",
    label: "Clip story",
    title: `${pageSection} story`,
    section: pageSection,
    summary: "Clip region saved. Add or correct extracted text before publishing.",
    body: "OCR draft will appear here after smart extraction. Review manually if needed.",
    area: "",
    tags: [...new Set(tags)].slice(0, 5),
    confidence: 0.45,
  };
}
