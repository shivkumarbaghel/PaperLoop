import type { User } from "firebase/auth";
import { addDoc, collection, getDocs, query, serverTimestamp, where } from "firebase/firestore";
import { deriveUserHandle } from "../lib/socialProfiles";
import { resolveCommentTimestamp } from "../lib/socialTime";
import { getFirebaseServices } from "../firebase";
import type { ArticlePost, Comment } from "../types";

export type EngagementType = "like" | "save" | "share" | "report" | "follow" | "comment";

export interface EngagementPayload {
  article: ArticlePost;
  type: EngagementType;
  metadata?: Record<string, string | number | boolean>;
  user: User;
}

export async function listArticleComments(articleId: string): Promise<Comment[]> {
  const firebase = getFirebaseServices();

  if (!firebase || !articleId) {
    return [];
  }

  const snapshot = await getDocs(
    query(collection(firebase.db, "comments"), where("articlePostId", "==", articleId)),
  );

  return snapshot.docs
    .map((documentSnapshot) => normalizeComment(documentSnapshot.id, documentSnapshot.data()))
    .filter((comment) => comment.status === "published")
    .sort((left, right) => resolveCommentTimestamp(right) - resolveCommentTimestamp(left))
    .map(({ status: _status, ...comment }) => comment);
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

  const userName = user.displayName ?? user.email ?? "PaperLoop reader";
  const userHandle = deriveUserHandle(userName, user.email?.split("@")[0] ?? null);
  const createdAtMs = Date.now();

  const localComment: Omit<Comment, "id"> = {
    userId: user.uid,
    userName,
    userHandle,
    userAvatarUrl: user.photoURL,
    body: trimmedBody,
    sentiment: "neutral",
    createdAtMs,
    stats: { likes: 0, shares: 0, saves: 0 },
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

function normalizeComment(id: string, data: Record<string, unknown>) {
  const createdAtMs = resolveCommentTimestamp({
    createdAtMs: typeof data.createdAtMs === "number" ? data.createdAtMs : undefined,
    createdAt: data.createdAt,
  });
  const userName = String(data.userName ?? "PaperLoop reader");
  const stats =
    data.stats && typeof data.stats === "object"
      ? {
          likes: Number((data.stats as { likes?: number }).likes ?? 0),
          shares: Number((data.stats as { shares?: number }).shares ?? 0),
          saves: Number((data.stats as { saves?: number }).saves ?? 0),
        }
      : { likes: 0, shares: 0, saves: 0 };

  return {
    id,
    userId: typeof data.userId === "string" ? data.userId : undefined,
    userName,
    userHandle:
      typeof data.userHandle === "string"
        ? data.userHandle
        : deriveUserHandle(userName),
    userAvatarUrl:
      typeof data.userAvatarUrl === "string"
        ? data.userAvatarUrl
        : data.userAvatarUrl === null
          ? null
          : undefined,
    body: String(data.body ?? ""),
    sentiment: (data.sentiment as Comment["sentiment"]) ?? "neutral",
    createdAtMs,
    stats,
    status: typeof data.status === "string" ? data.status : "published",
  };
}
