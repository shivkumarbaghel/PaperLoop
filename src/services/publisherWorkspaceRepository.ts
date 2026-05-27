import type { User } from "firebase/auth";
import {
  collection,
  doc,
  deleteField,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getBlob, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getFirebaseServices } from "../firebase";
import type {
  AccessRule,
  AdvertiserCampaign,
  ArticleBlock,
  ArticleBlockStatus,
  ArticleBlockType,
  ArticleHotspot,
  ArticlePost,
  Campaign,
  Comment,
  DiscussionRule,
  Edition,
  EditionStatus,
  Page,
} from "../types";

const maxUploadBytes = 25 * 1024 * 1024;
const allowedContentTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export interface EditionDraftInput {
  publisherId: string;
  title: string;
  date: string;
  city: string;
  language: string;
  sections: string[];
  accessRule: AccessRule;
  sourceFile: File;
}

export interface ArticleBlockInput {
  pageId: string;
  blockId?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  title: string;
  section: string;
  summary: string;
  body: string;
  authorName: string;
  accessRule: AccessRule;
  discussionRule: DiscussionRule;
  hotspotLabel: string;
}

export interface ArticleBlockDraftInput {
  blockId?: string;
  publisherId: string;
  editionId: string;
  pageId: string;
  pageNumber: number;
  type: ArticleBlockType;
  status: ArticleBlockStatus;
  source: "ai" | "manual";
  label: string;
  title: string;
  section: string;
  summary: string;
  body: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
}

export interface CampaignInput {
  publisherId: string;
  name: string;
  advertiserName: string;
  type: Campaign["type"];
  target: string;
  placementTarget: AdvertiserCampaign["placementTarget"];
  placementRef: string;
  budget: string;
  status: Campaign["status"];
}

export interface PublisherCommentActivity extends Comment {
  articlePostId: string;
  publisherId: string;
  editionId: string;
  pageId: string;
  status: string;
}

export async function createEditionDraft(
  input: EditionDraftInput,
  user: User,
): Promise<Edition> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  validateDraftInput(input);

  const editionRef = doc(firebase.db, "editions", createEditionId(input));
  const sourceAssetPath = [
    "publishers",
    input.publisherId,
    "editions",
    editionRef.id,
    "source",
    safeFileName(input.sourceFile.name),
  ].join("/");
  const storageRef = ref(firebase.storage, sourceAssetPath);

  await uploadBytes(storageRef, input.sourceFile, {
    contentType: input.sourceFile.type,
    customMetadata: {
      publisherId: input.publisherId,
      editionId: editionRef.id,
      uploadedBy: user.uid,
    },
  });

  const sourceAssetUrl = await getDownloadURL(storageRef);
  const edition: Edition = {
    id: editionRef.id,
    publisherId: input.publisherId,
    title: input.title.trim(),
    date: input.date,
    city: input.city.trim(),
    language: input.language.trim(),
    sections: input.sections,
    status: "processing",
    accessRule: input.accessRule,
    pages: [],
    sourceAssetPath,
    sourceAssetUrl,
    sourceAssetType: input.sourceFile.type,
    sourceAssetName: input.sourceFile.name,
    sourceAssetSize: input.sourceFile.size,
    createdBy: user.uid,
  };

  await setDoc(editionRef, {
    ...edition,
    processingQueuedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return edition;
}

export async function getPublisherArticleBlocks(
  publisherIds: string[],
): Promise<ArticleBlock[]> {
  const firebase = getFirebaseServices();

  if (!firebase || publisherIds.length === 0) {
    return [];
  }

  const snapshots = await Promise.all(
    chunk(publisherIds, 10).map((publisherIdChunk) =>
      getDocs(
        query(
          collection(firebase.db, "articleBlocks"),
          where("publisherId", "in", publisherIdChunk),
        ),
      ),
    ),
  );

  return snapshots
    .flatMap((snapshot) =>
      snapshot.docs.map((documentSnapshot) => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data(),
      })) as ArticleBlock[],
    )
    .sort((a, b) => a.pageNumber - b.pageNumber || a.y - b.y);
}

export async function getPublisherComments(
  publisherIds: string[],
): Promise<PublisherCommentActivity[]> {
  const firebase = getFirebaseServices();

  if (!firebase || publisherIds.length === 0) {
    return [];
  }

  const snapshots = await Promise.all(
    chunk(publisherIds, 10).map((publisherIdChunk) =>
      getDocs(
        query(
          collection(firebase.db, "comments"),
          where("publisherId", "in", publisherIdChunk),
        ),
      ),
    ),
  );

  return snapshots.flatMap((snapshot) =>
    snapshot.docs.map((documentSnapshot) => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data(),
    })) as PublisherCommentActivity[],
  );
}

export async function saveArticleBlockDraft(
  input: ArticleBlockDraftInput,
  user: User,
): Promise<ArticleBlock> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  validateBlockInput(input);

  const blockRef = input.blockId
    ? doc(firebase.db, "articleBlocks", input.blockId)
    : doc(collection(firebase.db, "articleBlocks"));
  const block: ArticleBlock = {
    id: blockRef.id,
    publisherId: input.publisherId,
    editionId: input.editionId,
    pageId: input.pageId,
    pageNumber: input.pageNumber,
    type: input.type,
    status: input.status,
    source: input.source,
    label: input.label.trim(),
    title: input.title.trim(),
    section: input.section.trim(),
    summary: input.summary.trim(),
    body: input.body.trim(),
    ...normalizeGeometry({
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
    }),
    confidence: input.confidence ?? (input.source === "manual" ? 1 : 0.65),
    createdBy: user.uid,
  };

  await setDoc(
    blockRef,
    {
      ...block,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );

  return block;
}

export async function updateArticleBlockStatus(
  block: ArticleBlock,
  status: ArticleBlockStatus,
): Promise<ArticleBlock> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  await updateDoc(doc(firebase.db, "articleBlocks", block.id), {
    status,
    updatedAt: serverTimestamp(),
  });

  return {
    ...block,
    status,
  };
}

export async function createAdvertiserCampaign(
  input: CampaignInput,
  user: User,
): Promise<AdvertiserCampaign> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  if (!input.publisherId || !input.name.trim() || !input.advertiserName.trim()) {
    throw new Error("Publisher, campaign name, and advertiser name are required.");
  }

  const campaignRef = doc(collection(firebase.db, "campaigns"));
  const campaign: AdvertiserCampaign = {
    id: campaignRef.id,
    publisherId: input.publisherId,
    name: input.name.trim(),
    advertiserName: input.advertiserName.trim(),
    type: input.type,
    target: input.target.trim(),
    placementTarget: input.placementTarget,
    placementRef: input.placementRef.trim() || input.publisherId,
    spend: input.budget.trim() || "Rs 0",
    budget: input.budget.trim() || "Rs 0",
    conversion: "0%",
    status: input.status,
  };

  await setDoc(campaignRef, {
    ...campaign,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return campaign;
}

export async function getPublisherWorkspaceEditions(
  publisherIds: string[],
): Promise<Edition[]> {
  const firebase = getFirebaseServices();

  if (!firebase || publisherIds.length === 0) {
    return [];
  }

  const snapshots = await Promise.all(
    chunk(publisherIds, 10).map((publisherIdChunk) =>
      getDocs(
        query(
          collection(firebase.db, "editions"),
          where("publisherId", "in", publisherIdChunk),
        ),
      ),
    ),
  );

  return snapshots
    .flatMap((snapshot) =>
      snapshot.docs.map((documentSnapshot) => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data(),
      })) as Edition[],
    )
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function updateEditionWorkflowStatus(
  edition: Edition,
  nextStatus: Extract<EditionStatus, "review" | "published" | "archived">,
  user: User,
): Promise<Edition> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  if (!edition.publisherId || !edition.id) {
    throw new Error("Edition record is missing publisher or edition id.");
  }

  const workflowFields =
    nextStatus === "published"
      ? {
          publishedAt: serverTimestamp(),
          publishedBy: user.uid,
        }
      : {
          reviewedAt: serverTimestamp(),
          reviewedBy: user.uid,
        };

  await updateDoc(doc(firebase.db, "editions", edition.id), {
    status: nextStatus,
    updatedAt: serverTimestamp(),
    ...workflowFields,
  });

  return {
    ...edition,
    status: nextStatus,
  };
}

export async function requestSmartEditionProcessing(
  edition: Edition,
  user: User,
): Promise<Edition> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  if (!edition.sourceAssetPath) {
    throw new Error("Upload a PDF or page image before smart processing.");
  }

  await updateDoc(doc(firebase.db, "editions", edition.id), {
    pages: [],
    status: "processing",
    processingError: deleteField(),
    processingQueuedAt: serverTimestamp(),
    processingQueuedBy: user.uid,
    updatedAt: serverTimestamp(),
  });

  return {
    ...edition,
    pages: [],
    status: "processing",
    processingError: undefined,
  };
}

export async function generateEditionPreviewPages(
  edition: Edition,
  user: User,
): Promise<Edition> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  if (!edition.id || !edition.publisherId) {
    throw new Error("Edition record is missing publisher or edition id.");
  }

  const pages = buildPreviewPages(edition);

  await updateDoc(doc(firebase.db, "editions", edition.id), {
    pages,
    status: "review",
    previewGeneratedAt: serverTimestamp(),
    previewGeneratedBy: user.uid,
    updatedAt: serverTimestamp(),
  });

  return {
    ...edition,
    pages,
    status: "review",
  };
}

export async function createArticleBlockFromPreviewPage(
  edition: Edition,
  input: ArticleBlockInput,
  user: User,
): Promise<{ article: ArticlePost; edition: Edition }> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  const page = edition.pages.find((editionPage) => editionPage.id === input.pageId);

  if (!page) {
    throw new Error("Choose a generated preview page for this article.");
  }

  validateArticleBlockInput(input);

  const sourceBlock = input.blockId ? await getArticleBlock(input.blockId) : null;
  const articleId = createArticleId(edition, input);
  const blockGeometry = normalizeGeometry({
    x: sourceBlock?.x ?? input.x ?? (page.hotspots.length % 2 === 0 ? 8 : 55),
    y: sourceBlock?.y ?? input.y ?? 18 + page.hotspots.length * 10,
    width: sourceBlock?.width ?? input.width ?? (page.hotspots.length % 2 === 0 ? 44 : 36),
    height: sourceBlock?.height ?? input.height ?? 22,
  });
  const clippedAsset = await createClippedArticleImage({
    edition,
    page,
    articleId,
    geometry: blockGeometry,
  });
  const hotspot: ArticleHotspot = {
    id: `${articleId}-hotspot`,
    articleId,
    label: input.hotspotLabel.trim(),
    ...blockGeometry,
    blockId: input.blockId,
    clippedImageUrl: clippedAsset?.url,
  };
  const nextPages = edition.pages.map((editionPage) =>
    editionPage.id === page.id
      ? {
          ...editionPage,
          hotspots: [
            ...editionPage.hotspots.filter(
              (existingHotspot) => existingHotspot.articleId !== articleId,
            ),
            hotspot,
          ],
        }
      : editionPage,
  );
  const article: ArticlePost = {
    id: articleId,
    publisherId: edition.publisherId,
    editionId: edition.id,
    pageId: page.id,
    pageNumber: page.pageNumber,
    status: "published",
    title: input.title.trim(),
    section: input.section.trim(),
    author: {
      id: slugify(input.authorName),
      name: input.authorName.trim(),
      publication: edition.title,
      topics: [input.section.trim()],
      bio: "Publisher staff article created from a PaperLoop preview page.",
      verified: true,
      followers: 0,
    },
    summary: input.summary.trim(),
    body: input.body.trim(),
    clippedImageTone: slugify(input.section) || "local",
    clippedImageUrl: clippedAsset?.url,
    clippedImagePath: clippedAsset?.path,
    sourcePageImageUrl: page.imageUrl,
    sourceBlockId: input.blockId,
    blockGeometry,
    accessRule: input.accessRule,
    discussionRule: input.discussionRule,
    stats: {
      views: 0,
      likes: 0,
      saves: 0,
      shares: 0,
      comments: 0,
    },
    comments: [],
    multimedia: [],
  };

  await Promise.all([
    setDoc(doc(firebase.db, "articlePosts", articleId), {
      ...article,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
    updateDoc(doc(firebase.db, "editions", edition.id), {
      pages: nextPages,
      updatedAt: serverTimestamp(),
    }),
    input.blockId
      ? updateDoc(doc(firebase.db, "articleBlocks", input.blockId), {
          articlePostId: articleId,
          clippedImageUrl: clippedAsset?.url,
          clippedImagePath: clippedAsset?.path,
          status: "published",
          updatedAt: serverTimestamp(),
        })
      : Promise.resolve(),
  ]);

  return {
    article,
    edition: {
      ...edition,
      pages: nextPages,
    },
  };
}

async function getArticleBlock(blockId: string) {
  const firebase = getFirebaseServices();

  if (!firebase) {
    return null;
  }

  const snapshot = await getDoc(doc(firebase.db, "articleBlocks", blockId));

  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as ArticleBlock) : null;
}

async function createClippedArticleImage({
  edition,
  page,
  articleId,
  geometry,
}: {
  edition: Edition;
  page: Page;
  articleId: string;
  geometry: { x: number; y: number; width: number; height: number };
}) {
  const firebase = getFirebaseServices();

  if (!firebase) {
    return null;
  }

  const sourceBlob = await getBlob(
    ref(firebase.storage, processedPageImagePath(edition, page)),
  );
  const imageBitmap = await createImageBitmap(sourceBlob);
  const crop = toPixelCrop(geometry, imageBitmap.width, imageBitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;

  const context = canvas.getContext("2d");

  if (!context) {
    imageBitmap.close();
    throw new Error("Unable to prepare the article clipping canvas.");
  }

  context.drawImage(
    imageBitmap,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  );
  imageBitmap.close();

  const clippedBlob = await canvasToBlob(canvas, "image/webp", 0.9);
  const clippedPath = [
    "publishers",
    edition.publisherId,
    "editions",
    edition.id,
    "article-clips",
    `${safeFileName(articleId)}.webp`,
  ].join("/");
  const clippedRef = ref(firebase.storage, clippedPath);

  await uploadBytes(clippedRef, clippedBlob, {
    contentType: "image/webp",
    customMetadata: {
      publisherId: edition.publisherId,
      editionId: edition.id,
      pageId: page.id,
      articleId,
    },
  });

  return {
    path: clippedPath,
    url: await getDownloadURL(clippedRef),
  };
}

function processedPageImagePath(edition: Edition, page: Page) {
  return [
    "publishers",
    edition.publisherId,
    "editions",
    edition.id,
    "pages",
    `page-${page.pageNumber}.png`,
  ].join("/");
}

function toPixelCrop(
  geometry: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
) {
  const x = Math.floor((clampPercent(geometry.x) / 100) * imageWidth);
  const y = Math.floor((clampPercent(geometry.y) / 100) * imageHeight);
  const maxWidth = Math.max(1, imageWidth - x);
  const maxHeight = Math.max(1, imageHeight - y);
  const width = Math.min(
    maxWidth,
    Math.max(1, Math.round((clampPercent(geometry.width) / 100) * imageWidth)),
  );
  const height = Math.min(
    maxHeight,
    Math.max(1, Math.round((clampPercent(geometry.height) / 100) * imageHeight)),
  );

  return { x, y, width, height };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Unable to create the clipped article image."));
          return;
        }

        resolve(blob);
      },
      type,
      quality,
    );
  });
}

function validateBlockInput(input: ArticleBlockDraftInput) {
  if (!input.publisherId || !input.editionId || !input.pageId || !input.label.trim()) {
    throw new Error("Publisher, edition, page, and block label are required.");
  }

  if (input.width <= 0 || input.height <= 0) {
    throw new Error("Block width and height must be greater than zero.");
  }
}

function clampPercent(value: number) {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function normalizeGeometry(
  geometry: { x: number; y: number; width: number; height: number },
) {
  const x = Math.min(99, clampPercent(geometry.x));
  const y = Math.min(99, clampPercent(geometry.y));
  const width = Math.max(1, Math.min(clampPercent(geometry.width), 100 - x));
  const height = Math.max(1, Math.min(clampPercent(geometry.height), 100 - y));

  return { x, y, width, height };
}

function validateDraftInput(input: EditionDraftInput) {
  if (!input.publisherId || !input.title.trim() || !input.date || !input.city.trim()) {
    throw new Error("Publisher, title, date, and city are required.");
  }

  if (!input.sections.length) {
    throw new Error("Add at least one edition section.");
  }

  if (!allowedContentTypes.has(input.sourceFile.type)) {
    throw new Error("Upload a PDF, JPG, PNG, or WebP issue asset.");
  }

  if (input.sourceFile.size > maxUploadBytes) {
    throw new Error("Issue asset must be 25 MB or smaller.");
  }
}

function validateArticleBlockInput(input: ArticleBlockInput) {
  if (
    !input.pageId ||
    !input.title.trim() ||
    !input.section.trim() ||
    !input.summary.trim() ||
    !input.body.trim() ||
    !input.authorName.trim() ||
    !input.hotspotLabel.trim()
  ) {
    throw new Error("Page, title, section, summary, body, author, and hotspot label are required.");
  }
}

function createEditionId(input: EditionDraftInput) {
  return `${input.publisherId}-${input.date}-${slugify(input.city)}`;
}

function createArticleId(edition: Edition, input: ArticleBlockInput) {
  if (input.blockId) {
    return `${input.blockId}-post`;
  }

  const articleSlug =
    slugify(input.title) ||
    slugify(input.hotspotLabel) ||
    `story-${Date.now().toString(36)}`;

  return `${edition.id}-${articleSlug}`;
}

function safeFileName(fileName: string) {
  const cleanName = fileName
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return cleanName || "source-issue";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function buildPreviewPages(edition: Edition): Page[] {
  const sections = edition.sections.length ? edition.sections : ["मुख पृष्ठ"];

  return sections.slice(0, 6).map((section, index) => ({
    id: `${edition.id}-preview-p${index + 1}`,
    editionId: edition.id,
    pageNumber: index + 1,
    section,
    headline: index === 0 ? edition.title : `${section} preview`,
    subhead: `${edition.city} edition • ${edition.date}`,
    hotspots: [],
  }));
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}
