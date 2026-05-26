import { collection, getDocs, query, where } from "firebase/firestore";
import { getFirebaseServices } from "../firebase";
import {
  articles as mockArticles,
  campaigns as mockCampaigns,
  editions as mockEditions,
  metrics as mockMetrics,
  publishers as mockPublishers,
} from "../data/mockData";
import type { ArticlePost, Campaign, Edition, MetricCard, Publisher } from "../types";

export interface PaperLoopContent {
  publishers: Publisher[];
  editions: Edition[];
  articles: ArticlePost[];
  metrics: MetricCard[];
  campaigns: Campaign[];
  source: "firestore" | "mock";
}

export const mockContent: PaperLoopContent = {
  publishers: mockPublishers,
  editions: mockEditions,
  articles: mockArticles,
  metrics: mockMetrics,
  campaigns: mockCampaigns,
  source: "mock",
};

export async function getPaperLoopContent(): Promise<PaperLoopContent> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    return mockContent;
  }

  return withTimeout(readFirestoreContent(), 3500, mockContent);
}

async function readFirestoreContent(): Promise<PaperLoopContent> {
  const [publishers, editions, articles, metrics, campaigns] = await Promise.all([
    readCollection<Publisher>("publishers"),
    readPublishedPublicEditions(),
    readPublishedPublicArticles(),
    readCollection<MetricCard>("metrics"),
    readCollection<Campaign>("campaigns"),
  ]);

  if (!publishers.length || !editions.length || !articles.length) {
    return mockContent;
  }

  return {
    publishers,
    editions,
    articles,
    metrics: metrics.length ? metrics : mockMetrics,
    campaigns: campaigns.length ? campaigns : mockCampaigns,
    source: "firestore",
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(fallback), timeoutMs);

    promise
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => window.clearTimeout(timeout));
  });
}

async function readPublishedPublicEditions() {
  const firebase = getFirebaseServices();

  if (!firebase) {
    return [];
  }

  try {
    const source = query(
      collection(firebase.db, "editions"),
      where("status", "==", "published"),
      where("accessRule", "==", "public"),
    );
    const snapshot = await getDocs(source);

    return snapshot.docs.map((documentSnapshot) => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data(),
    })) as Edition[];
  } catch {
    return [];
  }
}

async function readPublishedPublicArticles() {
  const firebase = getFirebaseServices();

  if (!firebase) {
    return [];
  }

  try {
    const source = query(
      collection(firebase.db, "articlePosts"),
      where("status", "==", "published"),
      where("accessRule", "==", "public"),
    );
    const snapshot = await getDocs(source);

    return snapshot.docs.map((documentSnapshot) => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data(),
    })) as ArticlePost[];
  } catch {
    return [];
  }
}

async function readCollection<T>(
  collectionName: string,
  publishedOnly = false,
) {
  const firebase = getFirebaseServices();

  if (!firebase) {
    return [];
  }

  try {
    const ref = collection(firebase.db, collectionName);
    const source = publishedOnly ? query(ref, where("status", "==", "published")) : ref;
    const snapshot = await getDocs(source);

    return snapshot.docs.map((documentSnapshot) => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data(),
    })) as T[];
  } catch {
    return [];
  }
}
