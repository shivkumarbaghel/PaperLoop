import type { User } from "firebase/auth";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getFirebaseServices } from "../firebase";
import type { ArticlePost, Comment } from "../types";

export type EngagementType = "like" | "save" | "share" | "report" | "follow" | "comment";

export interface EngagementPayload {
  article: ArticlePost;
  type: EngagementType;
  metadata?: Record<string, string | number | boolean>;
  user: User;
}

export async function createArticleComment(
  article: ArticlePost,
  body: string,
  user: User,
): Promise<Comment> {
  const firebase = getFirebaseServices();
  const trimmedBody = body.trim();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  if (!trimmedBody) {
    throw new Error("Comment cannot be empty.");
  }

  const localComment: Omit<Comment, "id"> = {
    userName: user.displayName ?? user.email ?? "PaperLoop reader",
    body: trimmedBody,
    sentiment: "neutral",
    createdAt: "Just now",
  };

  const documentRef = await addDoc(collection(firebase.db, "comments"), {
    ...localComment,
    userId: user.uid,
    publisherId: article.publisherId,
    editionId: article.editionId,
    pageId: article.pageId,
    articlePostId: article.id,
    status: "published",
    createdAt: serverTimestamp(),
  });

  await recordEngagement({
    article,
    type: "comment",
    user,
    metadata: { commentId: documentRef.id },
  });

  return {
    id: documentRef.id,
    ...localComment,
  };
}

export async function recordEngagement({
  article,
  type,
  metadata = {},
  user,
}: EngagementPayload) {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  await addDoc(collection(firebase.db, "engagements"), {
    userId: user.uid,
    publisherId: article.publisherId,
    editionId: article.editionId,
    pageId: article.pageId,
    articlePostId: article.id,
    type,
    metadata,
    status: "active",
    createdAt: serverTimestamp(),
  });
}
