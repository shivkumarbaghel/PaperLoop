import type { User } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import {
  collection,
  doc,
  deleteDoc,
  deleteField,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { deleteObject, getBlob, getDownloadURL, listAll, ref, uploadBytes } from "firebase/storage";
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
import {
  editionLocations as fallbackEditionLocations,
  type EditionLocation,
} from "../data/locationData";
import {
  editionLanguages as fallbackEditionLanguages,
  type EditionLanguage,
} from "../data/languageData";

const maxUploadBytes = 25 * 1024 * 1024;
const allowedContentTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export interface EditionDraftInput {
  publisherId: string;
  publisherName: string;
  title: string;
  date: string;
  state: string;
  city: string;
  language: string;
  sections: string[];
  accessRule: AccessRule;
  sourceFile: File;
}

export async function getEditionLocations(): Promise<EditionLocation[]> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    return fallbackEditionLocations;
  }

  try {
    const snapshot = await getDocs(collection(firebase.db, "editionLocations"));
    const locations = snapshot.docs
      .map((documentSnapshot) => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data(),
      }))
      .filter(isEditionLocation)
      .sort((a, b) => a.state.localeCompare(b.state));

    return locations.length ? locations : fallbackEditionLocations;
  } catch {
    return fallbackEditionLocations;
  }
}

export async function getEditionLanguages(): Promise<EditionLanguage[]> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    return fallbackEditionLanguages;
  }

  try {
    const snapshot = await getDocs(collection(firebase.db, "editionLanguages"));
    const languages = snapshot.docs
      .map((documentSnapshot) => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data(),
      }))
      .filter(isEditionLanguage)
      .sort((a, b) => a.name.localeCompare(b.name));

    return languages.length ? languages : fallbackEditionLanguages;
  } catch {
    return fallbackEditionLanguages;
  }
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
  city?: string;
  state?: string;
  area?: string;
  tags?: string[];
  authorName: string;
  editorId?: string;
  accessRule: AccessRule;
  discussionRule: DiscussionRule;
  hotspotLabel: string;
}

export interface ArticlePostUpdateInput {
  articleId: string;
  editionId: string;
  pageId: string;
  blockId?: string;
  type?: ArticleBlockType;
  title: string;
  section: string;
  summary: string;
  body: string;
  city?: string;
  state?: string;
  area?: string;
  tags?: string[];
  authorName: string;
  editorId?: string;
  accessRule: AccessRule;
  discussionRule: DiscussionRule;
  hotspotLabel: string;
  x: number;
  y: number;
  width: number;
  height: number;
  regenerateClipImage?: boolean;
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
  city?: string;
  state?: string;
  area?: string;
  tags?: string[];
  editorId?: string;
  authorName?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
}

export interface ClipRegionExtractionInput {
  publisherId: string;
  editionId: string;
  pageId: string;
  pageNumber: number;
  pageSection: string;
  editionCity?: string;
  editionState?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClipRegionExtraction {
  type: ArticleBlockType;
  label: string;
  title: string;
  section: string;
  summary: string;
  body: string;
  area: string;
  tags: string[];
  confidence: number;
  previewDataUrl?: string;
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

export interface PublisherEngagementActivity {
  id: string;
  articlePostId: string;
  publisherId: string;
  editionId: string;
  pageId: string;
  type: "like" | "save" | "share" | "report" | "follow" | "comment";
  status: string;
  userId?: string;
  metadata?: Record<string, string | number | boolean>;
  createdAt?: unknown;
}

export interface PublisherArticlePostDetail {
  article: ArticlePost;
  block: ArticleBlock | null;
  comments: PublisherCommentActivity[];
  engagements: PublisherEngagementActivity[];
}

export async function getPublisherArticlePostDetail(
  articleId: string,
  publisherIds: string[],
): Promise<PublisherArticlePostDetail | null> {
  const firebase = getFirebaseServices();

  if (!firebase || !articleId || publisherIds.length === 0) {
    return null;
  }

  const articleSnapshot = await getDoc(doc(firebase.db, "articlePosts", articleId));

  if (!articleSnapshot.exists()) {
    return null;
  }

  const article = {
    id: articleSnapshot.id,
    ...articleSnapshot.data(),
  } as ArticlePost;

  if (
    publisherIds.length > 0 &&
    !publisherIds.some((publisherId) => samePublisherId(publisherId, article.publisherId))
  ) {
    return null;
  }

  const [commentSnapshot, engagementSnapshot, sourceBlockSnapshot, linkedBlockSnapshot] =
    await Promise.all([
      getDocs(
        query(
          collection(firebase.db, "comments"),
          where("articlePostId", "==", article.id),
        ),
      ).catch(() => null),
      getDocs(
        query(
          collection(firebase.db, "engagements"),
          where("articlePostId", "==", article.id),
        ),
      ).catch(() => null),
      article.sourceBlockId
        ? getDoc(doc(firebase.db, "articleBlocks", article.sourceBlockId)).catch(() => null)
        : Promise.resolve(null),
      getDocs(
        query(
          collection(firebase.db, "articleBlocks"),
          where("articlePostId", "==", article.id),
        ),
      ).catch(() => null),
    ]);

  const comments = commentSnapshot
    ? (commentSnapshot.docs.map((documentSnapshot) => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data(),
      })) as PublisherCommentActivity[])
    : article.comments.map((comment) => ({
        ...comment,
        articlePostId: article.id,
        publisherId: article.publisherId,
        editionId: article.editionId,
        pageId: article.pageId,
        status: "published",
      }));
  const engagements = engagementSnapshot
    ? (engagementSnapshot.docs.map((documentSnapshot) => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data(),
      })) as PublisherEngagementActivity[])
    : [];
  const block = sourceBlockSnapshot?.exists()
    ? ({ id: sourceBlockSnapshot.id, ...sourceBlockSnapshot.data() } as ArticleBlock)
    : linkedBlockSnapshot?.docs[0]
      ? ({
          id: linkedBlockSnapshot.docs[0].id,
          ...linkedBlockSnapshot.docs[0].data(),
        } as ArticleBlock)
      : null;

  return {
    article,
    block,
    comments: comments.sort(compareActivityCreatedAt),
    engagements: engagements.sort(compareActivityCreatedAt),
  };
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

  const timestamp = formatEditionTimestamp(new Date());
  const editionRef = doc(firebase.db, "editions", createEditionId(input, timestamp));
  const editionTitle = buildEditionTitle({
    publisherName: input.publisherName,
    language: input.language,
    city: input.city,
    date: input.date,
    timestamp,
    headline: input.title,
  });
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
    title: editionTitle,
    date: input.date,
    state: input.state.trim(),
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

export async function appendEditionPagesFromFile(
  edition: Edition,
  sourceFile: File,
  user: User,
): Promise<Edition> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  if (!edition.id || !edition.publisherId) {
    throw new Error("Edition record is missing publisher or edition id.");
  }

  if (!allowedContentTypes.has(sourceFile.type)) {
    throw new Error("Upload a PDF, JPG, PNG, or WebP page asset.");
  }

  if (sourceFile.size > maxUploadBytes) {
    throw new Error("Page asset must be 25 MB or smaller.");
  }

  const incomingPath = [
    "publishers",
    edition.publisherId,
    "editions",
    edition.id,
    "incoming",
    `${Date.now()}-${safeFileName(sourceFile.name)}`,
  ].join("/");

  await uploadBytes(ref(firebase.storage, incomingPath), sourceFile, {
    contentType: sourceFile.type,
    customMetadata: {
      publisherId: edition.publisherId,
      editionId: edition.id,
      uploadedBy: user.uid,
    },
  });

  const callable = httpsCallable<
    {
      publisherId: string;
      editionId: string;
      sourceAssetPath: string;
      contentType: string;
    },
    { addedPageCount: number; pages: Page[] }
  >(firebase.functions, "appendEditionPages");

  await callable({
    publisherId: edition.publisherId,
    editionId: edition.id,
    sourceAssetPath: incomingPath,
    contentType: sourceFile.type,
  });

  const refreshedEdition = await getEditionById(edition.id);

  if (!refreshedEdition) {
    throw new Error("Pages were added but the edition could not be refreshed.");
  }

  return refreshedEdition;
}

export async function deletePublisherEdition(edition: Edition): Promise<void> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  if (!edition.id || !edition.publisherId) {
    throw new Error("Edition record is missing publisher or edition id.");
  }

  const [blocksSnapshot, postsSnapshot, commentsSnapshot, engagementsSnapshot, pageAssetsSnapshot] =
    await Promise.all([
      getDocs(
        query(
          collection(firebase.db, "articleBlocks"),
          where("editionId", "==", edition.id),
        ),
      ),
      getDocs(
        query(
          collection(firebase.db, "articlePosts"),
          where("editionId", "==", edition.id),
        ),
      ),
      getDocs(
        query(collection(firebase.db, "comments"), where("editionId", "==", edition.id)),
      ),
      getDocs(
        query(
          collection(firebase.db, "engagements"),
          where("editionId", "==", edition.id),
        ),
      ),
      getDocs(
        query(collection(firebase.db, "pageAssets"), where("editionId", "==", edition.id)),
      ),
    ]);

  const jobSnapshot = await getDoc(doc(firebase.db, "processingJobs", edition.id));

  await Promise.all([
    ...blocksSnapshot.docs.map((documentSnapshot) => deleteDoc(documentSnapshot.ref)),
    ...postsSnapshot.docs.map((documentSnapshot) => deleteDoc(documentSnapshot.ref)),
    ...commentsSnapshot.docs.map((documentSnapshot) => deleteDoc(documentSnapshot.ref)),
    ...engagementsSnapshot.docs.map((documentSnapshot) => deleteDoc(documentSnapshot.ref)),
    ...pageAssetsSnapshot.docs.map((documentSnapshot) => deleteDoc(documentSnapshot.ref)),
    jobSnapshot.exists()
      ? deleteDoc(doc(firebase.db, "processingJobs", edition.id))
      : Promise.resolve(),
    deleteDoc(doc(firebase.db, "editions", edition.id)),
  ]);

  try {
    await deleteStorageFolder(
      ref(firebase.storage, `publishers/${edition.publisherId}/editions/${edition.id}`),
    );
  } catch {
    // Storage cleanup is best-effort when files were never uploaded or already removed.
  }
}

export async function deletePublisherEditionPage(
  edition: Edition,
  pageId: string,
): Promise<Edition> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  if (!edition.id || !edition.publisherId) {
    throw new Error("Edition record is missing publisher or edition id.");
  }

  const page = edition.pages.find((editionPage) => editionPage.id === pageId);

  if (!page) {
    throw new Error("Page not found in this edition.");
  }

  const [blocksSnapshot, postsSnapshot, commentsSnapshot, engagementsSnapshot, pageAssetSnapshot] =
    await Promise.all([
      getDocs(
        query(collection(firebase.db, "articleBlocks"), where("pageId", "==", pageId)),
      ),
      getDocs(
        query(collection(firebase.db, "articlePosts"), where("pageId", "==", pageId)),
      ),
      getDocs(
        query(collection(firebase.db, "comments"), where("pageId", "==", pageId)),
      ),
      getDocs(
        query(collection(firebase.db, "engagements"), where("pageId", "==", pageId)),
      ),
      getDoc(doc(firebase.db, "pageAssets", pageId)),
    ]);

  const storageDeletes = [
    deleteStorageObject(editionPageImagePath(edition, page.pageNumber)),
    deleteStorageObject(editionPageThumbnailPath(edition, page.pageNumber)),
  ];

  postsSnapshot.docs.forEach((documentSnapshot) => {
    const post = documentSnapshot.data() as ArticlePost;

    if (post.clippedImagePath) {
      storageDeletes.push(deleteStorageObject(post.clippedImagePath));
    }
  });

  const nextPages = edition.pages.filter((editionPage) => editionPage.id !== pageId);

  await Promise.all([
    ...blocksSnapshot.docs.map((documentSnapshot) => deleteDoc(documentSnapshot.ref)),
    ...postsSnapshot.docs.map((documentSnapshot) => deleteDoc(documentSnapshot.ref)),
    ...commentsSnapshot.docs.map((documentSnapshot) => deleteDoc(documentSnapshot.ref)),
    ...engagementsSnapshot.docs.map((documentSnapshot) => deleteDoc(documentSnapshot.ref)),
    pageAssetSnapshot.exists() ? deleteDoc(pageAssetSnapshot.ref) : Promise.resolve(),
    updateDoc(doc(firebase.db, "editions", edition.id), {
      pages: nextPages,
      updatedAt: serverTimestamp(),
    }),
    ...storageDeletes,
  ]);

  return {
    ...edition,
    pages: nextPages,
  };
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

export async function extractClipRegionDetails(
  input: ClipRegionExtractionInput,
): Promise<ClipRegionExtraction> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  const callable = httpsCallable<ClipRegionExtractionInput, ClipRegionExtraction>(
    firebase.functions,
    "extractClipRegionDetails",
  );
  const response = await callable(input);

  return response.data;
}

export async function createDraftClipPreviewUrl(
  edition: Edition,
  page: Page,
  geometry: { x: number; y: number; width: number; height: number },
): Promise<string | null> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    return null;
  }

  try {
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
      return null;
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

    const clippedBlob = await canvasToBlob(canvas, "image/webp", 0.95);

    return URL.createObjectURL(clippedBlob);
  } catch {
    return null;
  }
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

  const locale = normalizeArticleLocaleFields({}, input);

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
    title: (input.title ?? "").trim(),
    section: (input.section ?? "").trim(),
    summary: (input.summary ?? "").trim(),
    body: (input.body ?? "").trim(),
    ...locale,
    editorId: input.editorId || undefined,
    authorName: input.authorName?.trim() || undefined,
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
      editorId: input.editorId || null,
      authorName: input.authorName?.trim() || null,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );

  return block;
}

export async function deleteArticleBlock(
  block: ArticleBlock,
  edition: Edition | null,
): Promise<{ edition: Edition | null }> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  await deleteDoc(doc(firebase.db, "articleBlocks", block.id));

  if (!edition || edition.id !== block.editionId) {
    return { edition: null };
  }

  const nextPages = edition.pages.map((page) => ({
    ...page,
    hotspots: page.hotspots.filter(
      (hotspot) =>
        hotspot.blockId !== block.id &&
        (!block.articlePostId || hotspot.articleId !== block.articlePostId),
    ),
  }));

  const hotspotsChanged = JSON.stringify(nextPages) !== JSON.stringify(edition.pages);

  if (!hotspotsChanged) {
    return { edition };
  }

  await updateDoc(doc(firebase.db, "editions", edition.id), {
    pages: nextPages,
    updatedAt: serverTimestamp(),
  });

  return {
    edition: {
      ...edition,
      pages: nextPages,
    },
  };
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
  const locale = normalizeArticleLocaleFields(
    {
      city: edition.city,
      state: edition.state,
    },
    input,
    sourceBlock ?? undefined,
  );
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
    ...locale,
    ...(input.editorId ? { editorId: input.editorId } : {}),
    author: {
      id: input.editorId ?? slugify(input.authorName),
      name: input.authorName.trim(),
      publication: edition.title,
      topics: locale.tags.length ? locale.tags : [input.section.trim()],
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
          city: locale.city,
          state: locale.state,
          area: locale.area,
          tags: locale.tags,
          ...(input.editorId ? { editorId: input.editorId } : {}),
          ...(input.authorName?.trim() ? { authorName: input.authorName.trim() } : {}),
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

export async function getEditionById(editionId: string): Promise<Edition | null> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    return null;
  }

  const snapshot = await getDoc(doc(firebase.db, "editions", editionId));

  return snapshot.exists()
    ? ({ id: snapshot.id, ...snapshot.data() } as Edition)
    : null;
}

export async function updatePublisherArticlePost(
  input: ArticlePostUpdateInput,
  user: User,
): Promise<{ article: ArticlePost; edition: Edition; block: ArticleBlock | null }> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  const editionSnapshot = await getDoc(doc(firebase.db, "editions", input.editionId));

  if (!editionSnapshot.exists()) {
    throw new Error("Edition not found for this post.");
  }

  const edition = { id: editionSnapshot.id, ...editionSnapshot.data() } as Edition;
  const articleSnapshot = await getDoc(doc(firebase.db, "articlePosts", input.articleId));

  if (!articleSnapshot.exists()) {
    throw new Error("Article post not found.");
  }

  const existingArticle = {
    id: articleSnapshot.id,
    ...articleSnapshot.data(),
  } as ArticlePost;
  const page = edition.pages.find((editionPage) => editionPage.id === input.pageId);

  if (!page) {
    throw new Error("Page not found for this article post.");
  }

  if (!input.title.trim() || !input.section.trim() || !input.hotspotLabel.trim()) {
    throw new Error("Title, section, and hotspot label are required.");
  }

  const sourceBlock = input.blockId ? await getArticleBlock(input.blockId) : null;
  const blockGeometry = normalizeGeometry({
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
  });
  const locale = normalizeArticleLocaleFields(
    {
      city: edition.city,
      state: edition.state,
    },
    input,
    sourceBlock ?? undefined,
    existingArticle,
  );
  const geometryChanged =
    JSON.stringify(existingArticle.blockGeometry ?? null) !== JSON.stringify(blockGeometry);
  const shouldRegenerateClip = input.regenerateClipImage || geometryChanged;
  const clippedAsset = shouldRegenerateClip
    ? await createClippedArticleImage({
        edition,
        page,
        articleId: existingArticle.id,
        geometry: blockGeometry,
      })
    : null;
  const hotspot: ArticleHotspot = {
    id: `${existingArticle.id}-hotspot`,
    articleId: existingArticle.id,
    label: input.hotspotLabel.trim(),
    ...blockGeometry,
    blockId: input.blockId ?? existingArticle.sourceBlockId,
    clippedImageUrl: clippedAsset?.url ?? existingArticle.clippedImageUrl,
  };
  const nextPages = edition.pages.map((editionPage) =>
    editionPage.id === page.id
      ? {
          ...editionPage,
          hotspots: [
            ...editionPage.hotspots.filter(
              (existingHotspot) => existingHotspot.articleId !== existingArticle.id,
            ),
            hotspot,
          ],
        }
      : editionPage,
  );
  const updatedArticle: ArticlePost = {
    ...existingArticle,
    title: input.title.trim(),
    section: input.section.trim(),
    summary: input.summary.trim(),
    body: input.body.trim(),
    ...locale,
    clippedImageTone: slugify(input.section) || existingArticle.clippedImageTone,
    clippedImageUrl: clippedAsset?.url ?? existingArticle.clippedImageUrl,
    clippedImagePath: clippedAsset?.path ?? existingArticle.clippedImagePath,
    blockGeometry,
    accessRule: input.accessRule,
    discussionRule: input.discussionRule,
    ...(input.editorId !== undefined
      ? { editorId: input.editorId || undefined }
      : {}),
    author: {
      ...existingArticle.author,
      id: input.editorId ?? existingArticle.author.id,
      name: input.authorName.trim() || existingArticle.author.name,
      topics: locale.tags.length ? locale.tags : [input.section.trim()],
    },
  };
  const blockUpdates =
    input.blockId && sourceBlock
      ? {
          type: input.type ?? sourceBlock.type,
          title: input.title.trim(),
          section: input.section.trim(),
          summary: input.summary.trim(),
          body: input.body.trim(),
          city: locale.city,
          state: locale.state,
          area: locale.area,
          tags: locale.tags,
      ...(input.editorId !== undefined
        ? { editorId: input.editorId || null }
        : {}),
          ...(input.authorName?.trim()
            ? { authorName: input.authorName.trim() }
            : {}),
          ...blockGeometry,
          clippedImageUrl: clippedAsset?.url ?? sourceBlock.clippedImageUrl,
          clippedImagePath: clippedAsset?.path ?? sourceBlock.clippedImagePath,
          updatedAt: serverTimestamp(),
        }
      : null;

  await Promise.all([
    updateDoc(doc(firebase.db, "articlePosts", existingArticle.id), {
      title: updatedArticle.title,
      section: updatedArticle.section,
      summary: updatedArticle.summary,
      body: updatedArticle.body,
      city: updatedArticle.city,
      state: updatedArticle.state,
      area: updatedArticle.area,
      tags: updatedArticle.tags,
      clippedImageTone: updatedArticle.clippedImageTone,
      clippedImageUrl: updatedArticle.clippedImageUrl,
      clippedImagePath: updatedArticle.clippedImagePath,
      blockGeometry,
      accessRule: updatedArticle.accessRule,
      discussionRule: updatedArticle.discussionRule,
      author: updatedArticle.author,
      ...(input.editorId !== undefined
        ? { editorId: input.editorId || null }
        : {}),
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    }),
    updateDoc(doc(firebase.db, "editions", edition.id), {
      pages: nextPages,
      updatedAt: serverTimestamp(),
    }),
    blockUpdates && input.blockId
      ? updateDoc(doc(firebase.db, "articleBlocks", input.blockId), blockUpdates)
      : Promise.resolve(),
  ]);

  const block = input.blockId ? await getArticleBlock(input.blockId) : null;

  return {
    article: updatedArticle,
    edition: {
      ...edition,
      pages: nextPages,
    },
    block,
  };
}

const allowedClipImageContentTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export interface ClipImageUploadInput {
  articleId: string;
  editionId: string;
  pageId: string;
  publisherId: string;
  blockId?: string;
  imageFile: File;
}

export async function uploadPublisherClipImage(
  input: ClipImageUploadInput,
  user: User,
): Promise<{ article: ArticlePost; edition: Edition; block: ArticleBlock | null }> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  if (!allowedClipImageContentTypes.has(input.imageFile.type)) {
    throw new Error("Upload a JPEG, PNG, or WebP image.");
  }

  if (input.imageFile.size > maxUploadBytes) {
    throw new Error("Image must be 25 MB or smaller.");
  }

  const editionSnapshot = await getDoc(doc(firebase.db, "editions", input.editionId));

  if (!editionSnapshot.exists()) {
    throw new Error("Edition not found for this post.");
  }

  const edition = { id: editionSnapshot.id, ...editionSnapshot.data() } as Edition;
  const articleSnapshot = await getDoc(doc(firebase.db, "articlePosts", input.articleId));

  if (!articleSnapshot.exists()) {
    throw new Error("Article post not found.");
  }

  const existingArticle = {
    id: articleSnapshot.id,
    ...articleSnapshot.data(),
  } as ArticlePost;
  const page = edition.pages.find((editionPage) => editionPage.id === input.pageId);

  if (!page) {
    throw new Error("Page not found for this article post.");
  }

  const clippedPath = [
    "publishers",
    input.publisherId,
    "editions",
    edition.id,
    "article-clips",
    `${safeFileName(input.articleId)}.webp`,
  ].join("/");
  const clippedRef = ref(firebase.storage, clippedPath);
  const clippedBlob = await prepareReplacementClipBlob(input.imageFile);

  await uploadBytes(clippedRef, clippedBlob, {
    contentType: "image/webp",
    customMetadata: {
      publisherId: input.publisherId,
      editionId: edition.id,
      pageId: page.id,
      articleId: input.articleId,
      uploadedBy: user.uid,
    },
  });

  const clippedImageUrl = cacheBustedStorageUrl(await getDownloadURL(clippedRef));
  const sourceBlock = input.blockId ? await getArticleBlock(input.blockId) : null;
  const existingHotspot = page.hotspots.find(
    (hotspot) => hotspot.articleId === existingArticle.id,
  );
  const blockGeometry = sourceBlock
    ? normalizeGeometry({
        x: sourceBlock.x,
        y: sourceBlock.y,
        width: sourceBlock.width,
        height: sourceBlock.height,
      })
    : existingHotspot
      ? normalizeGeometry(existingHotspot)
      : existingArticle.blockGeometry
        ? normalizeGeometry(existingArticle.blockGeometry)
        : { x: 0, y: 0, width: 100, height: 100 };
  const hotspot: ArticleHotspot = {
    id: `${existingArticle.id}-hotspot`,
    articleId: existingArticle.id,
    label: existingHotspot?.label ?? existingArticle.title,
    ...blockGeometry,
    blockId: input.blockId ?? existingArticle.sourceBlockId,
    clippedImageUrl,
  };
  const nextPages = edition.pages.map((editionPage) =>
    editionPage.id === page.id
      ? {
          ...editionPage,
          hotspots: [
            ...editionPage.hotspots.filter(
              (existingHotspot) => existingHotspot.articleId !== existingArticle.id,
            ),
            hotspot,
          ],
        }
      : editionPage,
  );
  const updatedArticle: ArticlePost = {
    ...existingArticle,
    clippedImageUrl,
    clippedImagePath: clippedPath,
  };
  const blockUpdates =
    input.blockId && sourceBlock
      ? {
          clippedImageUrl,
          clippedImagePath: clippedPath,
          updatedAt: serverTimestamp(),
        }
      : null;

  await Promise.all([
    updateDoc(doc(firebase.db, "articlePosts", existingArticle.id), {
      clippedImageUrl,
      clippedImagePath: clippedPath,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    }),
    updateDoc(doc(firebase.db, "editions", edition.id), {
      pages: nextPages,
      updatedAt: serverTimestamp(),
    }),
    blockUpdates && input.blockId
      ? updateDoc(doc(firebase.db, "articleBlocks", input.blockId), blockUpdates)
      : Promise.resolve(),
  ]);

  const block = input.blockId ? await getArticleBlock(input.blockId) : null;

  return {
    article: updatedArticle,
    edition: {
      ...edition,
      pages: nextPages,
    },
    block,
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

  const clippedBlob = await canvasToBlob(canvas, "image/webp", 0.95);
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
    url: cacheBustedStorageUrl(await getDownloadURL(clippedRef)),
  };
}

function processedPageImagePath(edition: Edition, page: Page) {
  return editionPageImagePath(edition, page.pageNumber);
}

function editionPageImagePath(edition: Edition, pageNumber: number) {
  return [
    "publishers",
    edition.publisherId,
    "editions",
    edition.id,
    "pages",
    `page-${pageNumber}.png`,
  ].join("/");
}

function editionPageThumbnailPath(edition: Edition, pageNumber: number) {
  return [
    "publishers",
    edition.publisherId,
    "editions",
    edition.id,
    "thumbnails",
    `page-${pageNumber}.webp`,
  ].join("/");
}

async function deleteStorageObject(storagePath: string) {
  const firebase = getFirebaseServices();

  if (!firebase) {
    return;
  }

  try {
    await deleteObject(ref(firebase.storage, storagePath));
  } catch {
    // Storage cleanup is best-effort when files were never uploaded or already removed.
  }
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

function cacheBustedStorageUrl(url: string, version = Date.now()) {
  const parsed = new URL(url);
  parsed.searchParams.set("v", String(version));
  return parsed.toString();
}

async function prepareReplacementClipBlob(imageFile: File): Promise<Blob> {
  if (imageFile.type === "image/webp") {
    return imageFile;
  }

  const imageBitmap = await createImageBitmap(imageFile);
  const canvas = document.createElement("canvas");
  canvas.width = imageBitmap.width;
  canvas.height = imageBitmap.height;
  const context = canvas.getContext("2d");

  if (!context) {
    imageBitmap.close();
    throw new Error("Unable to prepare the replacement clip image.");
  }

  context.drawImage(imageBitmap, 0, 0);
  imageBitmap.close();

  return canvasToBlob(canvas, "image/webp", 0.95);
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
  if (
    !input.publisherId ||
    !input.publisherName.trim() ||
    !input.date ||
    !input.state.trim() ||
    !input.city.trim() ||
    !input.language.trim()
  ) {
    throw new Error("Publisher, date, state, city, and language are required.");
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
    !input.authorName.trim()
  ) {
    throw new Error("Page and author are required.");
  }
}

function normalizeArticleLocaleFields(
  defaults: { city?: string; state?: string },
  input: {
    city?: string;
    state?: string;
    area?: string;
    tags?: string[];
    section?: string;
  },
  block?: Pick<ArticleBlock, "city" | "state" | "area" | "tags" | "section">,
  article?: Pick<ArticlePost, "city" | "state" | "area" | "tags" | "section">,
) {
  const tags = normalizeTags(
    input.tags ?? block?.tags ?? article?.tags ?? [input.section ?? block?.section ?? ""],
  );

  return {
    city: pickLocaleField(input.city, block?.city, article?.city, defaults.city),
    state: pickLocaleField(input.state, block?.state, article?.state, defaults.state),
    area: pickLocaleField(input.area, block?.area, article?.area),
    tags,
  };
}

function pickLocaleField(...candidates: (string | undefined)[]) {
  for (const candidate of candidates) {
    const value = candidate?.trim();

    if (value) {
      return value;
    }
  }

  return "";
}

function normalizeTags(tags: unknown) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return [...new Set(
    tags
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter(Boolean),
  )].slice(0, 8);
}

function createEditionId(input: EditionDraftInput, timestamp: string) {
  return `${input.publisherId}-${input.date}-${slugify(input.city)}-${timestamp}`;
}

function formatEditionTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join("");
}

function buildEditionTitle(input: {
  publisherName: string;
  language: string;
  city: string;
  date: string;
  timestamp: string;
  headline: string;
}) {
  const publisherName = input.publisherName.trim() || "Edition";
  const language = input.language.trim() || "Language";
  const city = input.city.trim() || "City";
  const headline = input.headline.trim();
  const baseTitle = `${publisherName} • ${language} • ${city} • ${input.date} • ${input.timestamp}`;

  return headline ? `${baseTitle} — ${headline}` : baseTitle;
}

async function deleteStorageFolder(folderRef: ReturnType<typeof ref>) {
  const listing = await listAll(folderRef);

  await Promise.all([
    ...listing.items.map((itemRef) => deleteObject(itemRef)),
    ...listing.prefixes.map((prefixRef) => deleteStorageFolder(prefixRef)),
  ]);
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

function isEditionLocation(value: unknown): value is EditionLocation {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "state" in value &&
    "cities" in value &&
    typeof value.id === "string" &&
    typeof value.state === "string" &&
    Array.isArray(value.cities) &&
    value.cities.every((city) => typeof city === "string")
  );
}

function isEditionLanguage(value: unknown): value is EditionLanguage {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    "nativeName" in value &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.nativeName === "string"
  );
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

function samePublisherId(left: string, right: string) {
  return normalizePublisherId(left) === normalizePublisherId(right);
}

function normalizePublisherId(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function compareActivityCreatedAt(
  a: { createdAt?: unknown },
  b: { createdAt?: unknown },
) {
  return activityTime(b.createdAt) - activityTime(a.createdAt);
}

function activityTime(value: unknown) {
  if (value && typeof value === "object" && "toMillis" in value) {
    return (value as { toMillis: () => number }).toMillis();
  }

  if (typeof value === "string") {
    return Date.parse(value) || 0;
  }

  return 0;
}
