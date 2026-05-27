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
import type { AccessRule, Edition, EditionStatus } from "../types";

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

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}
