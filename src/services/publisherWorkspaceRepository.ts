import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getFirebaseServices } from "../firebase";
import type {
  AccessRule,
  ArticleHotspot,
  ArticlePost,
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
  title: string;
  section: string;
  summary: string;
  body: string;
  authorName: string;
  accessRule: AccessRule;
  discussionRule: DiscussionRule;
  hotspotLabel: string;
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
    status: "review",
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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return edition;
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

  const articleId = `${edition.id}-${slugify(input.title)}`;
  const hotspot: ArticleHotspot = {
    id: `${articleId}-hotspot`,
    articleId,
    label: input.hotspotLabel.trim(),
    x: page.hotspots.length % 2 === 0 ? 8 : 55,
    y: 18 + page.hotspots.length * 10,
    width: page.hotspots.length % 2 === 0 ? 44 : 36,
    height: 22,
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
    accessRule: input.accessRule,
    discussionRule: input.discussionRule,
    stats: {
      views: 0,
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
  ]);

  return {
    article,
    edition: {
      ...edition,
      pages: nextPages,
    },
  };
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
