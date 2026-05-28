import type { User } from "firebase/auth";
import { addDoc, collection, getDocs, query, serverTimestamp, where } from "firebase/firestore";
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
    .map((documentSnapshot) => {
      const data = documentSnapshot.data();

      return {
        id: documentSnapshot.id,
        userName: String(data.userName ?? "PaperLoop reader"),
        body: String(data.body ?? ""),
        sentiment: (data.sentiment as Comment["sentiment"]) ?? "neutral",
        createdAt: data.createdAt,
        status: typeof data.status === "string" ? data.status : "published",
      };
    })
    .filter((comment) => comment.status === "published")
    .sort((left, right) => commentCreatedTime(right.createdAt) - commentCreatedTime(left.createdAt))
    .map(({ status: _status, ...comment }) => ({
      ...comment,
      createdAt: formatCommentCreatedAt(comment.createdAt),
    }));
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

function commentCreatedTime(value: unknown) {
  if (value && typeof value === "object" && "toMillis" in value) {
    return (value as { toMillis: () => number }).toMillis();
  }

  if (typeof value === "string") {
    return Date.parse(value) || 0;
  }

  return 0;
}

function formatCommentCreatedAt(value: unknown) {
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate().toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  if (typeof value === "string" && value !== "Just now") {
    const parsed = Date.parse(value);

    if (Number.isFinite(parsed)) {
      return new Date(parsed).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    }
  }

  return typeof value === "string" ? value : "Recent";
}
