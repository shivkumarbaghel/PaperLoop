import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, type WriteBatch } from "firebase-admin/firestore";
import {
  articleBlocks,
  articles,
  campaigns,
  editions,
  metrics,
  publishers,
} from "../src/data/mockData";
import { editionLocations } from "../src/data/locationData";
import { editionLanguages } from "../src/data/languageData";

interface SeedDocument {
  id: string;
  [key: string]: unknown;
}

loadLocalEnv();

const projectId =
  process.env.FIREBASE_PROJECT_ID ??
  process.env.GCLOUD_PROJECT ??
  process.env.VITE_FIREBASE_PROJECT_ID;
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const serviceAccountPath =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ?? resolve("serviceAccountKey.json");
const firestoreDatabaseId = process.env.FIRESTORE_DATABASE_ID ?? "(default)";
const legacyPublisherIds = [
  "bharat-daily",
  "dakshin-samachar",
  "purvanchal-patrika",
  "dainik-jagran",
  "live-hindustan",
  "navodaya-times",
];
const seededReaderPassword = process.env.PAPERLOOP_TEST_PASSWORD ?? "abc123";
const seededReaderAccounts = [
  {
    loginId: "reader-priya",
    email: "reader-priya@paperloop.test",
    name: "Priya Reader",
  },
  {
    loginId: "reader-aman",
    email: "reader-aman@paperloop.test",
    name: "Aman Delhi",
  },
  {
    loginId: "reader-neha",
    email: "reader-neha@paperloop.test",
    name: "Neha Subscriber",
  },
  {
    loginId: "reader-ravi",
    email: "reader-ravi@paperloop.test",
    name: "Ravi Sharma",
  },
];
const seededCommentBodies = [
  "Is story par local follow-up useful rahega.",
  "Please add source page link and latest update time.",
  "Good coverage. Area-wise details bhi milne chahiye.",
  "Readers ke questions ke liye publisher reply option helpful hoga.",
];
const seededEngagementTypes = ["like", "save", "share", "comment"] as const;

function loadLocalEnv() {
  const envPath = resolve(".env");

  if (!existsSync(envPath)) {
    return;
  }

  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .forEach((line) => {
      const separatorIndex = line.indexOf("=");

      if (separatorIndex === -1) {
        return;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");

      process.env[key] ??= value;
    });
}

function getCredential() {
  if (serviceAccountJson) {
    return cert(JSON.parse(serviceAccountJson) as Record<string, string>);
  }

  if (existsSync(serviceAccountPath)) {
    return cert(JSON.parse(readFileSync(serviceAccountPath, "utf8")) as Record<string, string>);
  }

  return applicationDefault();
}

const app = initializeApp({
  credential: getCredential(),
  projectId,
});

const db = getFirestore(app, firestoreDatabaseId);
const auth = getAuth(app);

if (!projectId) {
  throw new Error(
    "Missing Firebase project id. Add VITE_FIREBASE_PROJECT_ID to .env or set FIREBASE_PROJECT_ID.",
  );
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function writeCollection(collectionName: string, documents: SeedDocument[]) {
  const batch = db.batch();

  documents.forEach(({ id, ...data }) => {
    batch.set(
      db.collection(collectionName).doc(id),
      {
        id,
        ...data,
        seededAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  await batch.commit();
  console.log(`Seeded ${documents.length} ${collectionName} documents.`);
}

async function deleteDocuments(collectionName: string, documentIds: string[]) {
  const batch = db.batch();

  documentIds.forEach((documentId) => {
    batch.delete(db.collection(collectionName).doc(documentId));
  });

  await batch.commit();
  console.log(`Removed ${documentIds.length} legacy ${collectionName} documents.`);
}

async function seedAccessFixtures() {
  const superAdminUid = process.env.PAPERLOOP_SEED_SUPER_ADMIN_UID;
  const staffUid = process.env.PAPERLOOP_SEED_PUBLISHER_STAFF_UID;
  const subscriberUid = process.env.PAPERLOOP_SEED_SUBSCRIBER_UID;
  const publisherId = process.env.PAPERLOOP_SEED_PUBLISHER_ID ?? publishers[0].id;

  if (superAdminUid) {
    await db.collection("users").doc(superAdminUid).set(
      {
        id: superAdminUid,
        name: process.env.PAPERLOOP_SEED_SUPER_ADMIN_NAME ?? "PaperLoop Admin",
        email: process.env.PAPERLOOP_SEED_SUPER_ADMIN_EMAIL ?? null,
        avatarUrl: null,
        provider: process.env.PAPERLOOP_SEED_SUPER_ADMIN_PROVIDER ?? "google",
        role: "super_admin",
        status: "active",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await setRoleClaims(superAdminUid, "super_admin", [publisherId]);
    console.log("Seeded super admin user.");
  }

  if (staffUid) {
    const staffRole = process.env.PAPERLOOP_SEED_PUBLISHER_STAFF_ROLE ?? "publisher_admin";

    await db.collection("publisherStaff").doc(`${publisherId}_${staffUid}`).set(
      {
        id: `${publisherId}_${staffUid}`,
        userId: staffUid,
        publisherId,
        role: staffRole,
        status: "active",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await setRoleClaims(staffUid, staffRole, [publisherId]);
    console.log("Seeded publisher staff membership.");
  }

  if (subscriberUid) {
    await db.collection("subscriptions").doc(`${subscriberUid}_${publisherId}`).set(
      {
        id: `${subscriberUid}_${publisherId}`,
        userId: subscriberUid,
        publisherId,
        planType: "reader_paid",
        status: "active",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    console.log("Seeded reader subscription.");
  }
}

async function seedReaderActivityFixtures() {
  const readerUsers = await Promise.all(
    seededReaderAccounts.map(async (account) => {
      const user = await upsertReaderAuthUser(account);

      await auth.setCustomUserClaims(user.uid, {
        ...user.customClaims,
        role: "reader",
        publisherIds: [],
      });

      await db.collection("users").doc(user.uid).set(
        {
          id: user.uid,
          loginId: account.loginId,
          name: account.name,
          email: account.email,
          avatarUrl: null,
          provider: "password",
          role: "reader",
          status: "active",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      await db.collection("testAccounts").doc(account.loginId).set(
        {
          id: account.loginId,
          loginId: account.loginId,
          email: account.email,
          password: seededReaderPassword,
          role: "reader",
          firebaseRole: "reader",
          publisherId: null,
          userId: user.uid,
          status: "active",
          testingOnly: true,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return { ...account, uid: user.uid };
    }),
  );
  const articleSnapshot = await db.collection("articlePosts").get();
  const seededArticles = articleSnapshot.docs
    .map((articleDoc) => ({
      id: articleDoc.id,
      ...articleDoc.data(),
    }))
    .filter(isSeedableArticle);
  const writes: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];

  seededArticles.forEach((article, articleIndex) => {
    const linkFields = {
      publisherId: article.publisherId,
      editionId: article.editionId,
      pageId: article.pageId,
      articlePostId: article.id,
    };
    const articleCommentCount = Math.min(3, readerUsers.length);
    const likeCount = readerUsers.length;
    const saveCount = Math.ceil(readerUsers.length / 2);
    const shareCount = Math.floor(readerUsers.length / 2);

    readerUsers.slice(0, articleCommentCount).forEach((reader, readerIndex) => {
      const id = `${article.id}-seed-comment-${reader.loginId}`;

      writes.push((batch) =>
        batch.set(
          db.collection("comments").doc(id),
          {
            id,
            ...linkFields,
            userId: reader.uid,
            userName: reader.name,
            body: seededCommentBodies[(articleIndex + readerIndex) % seededCommentBodies.length],
            sentiment: readerIndex === 0 ? "concern" : "neutral",
            status: "published",
            createdAt: seedActivityDate(articleIndex, readerIndex),
            seededAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        ),
      );
    });

    readerUsers.forEach((reader, readerIndex) => {
      const eventTypes = seededEngagementTypes.filter((type) => {
        if (type === "save") {
          return readerIndex % 2 === 0;
        }

        if (type === "share") {
          return readerIndex % 2 === 1;
        }

        if (type === "comment") {
          return readerIndex < articleCommentCount;
        }

        return true;
      });

      eventTypes.forEach((type, typeIndex) => {
        const id = `${article.id}-seed-${type}-${reader.loginId}`;

        writes.push((batch) =>
          batch.set(
            db.collection("engagements").doc(id),
            {
              id,
              ...linkFields,
              userId: reader.uid,
              type,
              status: "active",
              metadata: { seed: true },
              createdAt: seedActivityDate(articleIndex, readerIndex + typeIndex + 4),
              seededAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          ),
        );
      });
    });

    writes.push((batch) =>
      batch.set(
        db.collection("articlePosts").doc(article.id),
        {
          stats: {
            views: Math.max(article.stats?.views ?? 0, 1800 + articleIndex * 315),
            likes: Math.max(article.stats?.likes ?? 0, likeCount),
            saves: Math.max(article.stats?.saves ?? 0, saveCount),
            shares: Math.max(article.stats?.shares ?? 0, shareCount),
            comments: Math.max(article.stats?.comments ?? 0, articleCommentCount),
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      ),
    );
  });

  await commitBatchedWrites(writes);
  console.log(
    `Seeded ${readerUsers.length} reader accounts and activity for ${seededArticles.length} article posts.`,
  );
}

async function publishReaderReadyEditions() {
  const [editionSnapshot, articleSnapshot] = await Promise.all([
    db.collection("editions").where("accessRule", "==", "public").get(),
    db.collection("articlePosts").where("status", "==", "published").get(),
  ]);
  const editionIdsWithPublishedPosts = new Set(
    articleSnapshot.docs
      .map((articleDoc) => articleDoc.data().editionId)
      .filter((editionId): editionId is string => typeof editionId === "string"),
  );
  const readerReadyEditions = editionSnapshot.docs.filter((editionDoc) => {
    const edition = editionDoc.data();

    return (
      edition.status !== "published" &&
      Array.isArray(edition.pages) &&
      edition.pages.length > 0 &&
      editionIdsWithPublishedPosts.has(editionDoc.id)
    );
  });

  if (readerReadyEditions.length === 0) {
    console.log("No reader-ready editions needed publishing.");
    return;
  }

  const batch = db.batch();

  readerReadyEditions.forEach((editionDoc) => {
    batch.set(
      editionDoc.ref,
      {
        status: "published",
        publishedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  await batch.commit();
  console.log(`Published ${readerReadyEditions.length} reader-ready editions.`);
}

async function upsertReaderAuthUser(account: {
  email: string;
  name: string;
}) {
  try {
    const user = await auth.getUserByEmail(account.email);

    return auth.updateUser(user.uid, {
      displayName: account.name,
      password: seededReaderPassword,
      disabled: false,
    });
  } catch (error) {
    if (!isAuthUserNotFoundError(error)) {
      throw error;
    }

    return auth.createUser({
      email: account.email,
      password: seededReaderPassword,
      displayName: account.name,
      emailVerified: true,
      disabled: false,
    });
  }
}

async function commitBatchedWrites(
  writes: Array<(batch: WriteBatch) => void>,
) {
  for (let index = 0; index < writes.length; index += 450) {
    const batch = db.batch();

    writes.slice(index, index + 450).forEach((write) => write(batch));
    await batch.commit();
  }
}

function seedActivityDate(articleIndex: number, offset: number) {
  return new Date(Date.UTC(2026, 4, 28, 3 + (articleIndex % 8), offset * 7));
}

function isSeedableArticle(value: unknown): value is {
  id: string;
  publisherId: string;
  editionId: string;
  pageId: string;
  stats?: {
    views?: number;
    likes?: number;
    saves?: number;
    shares?: number;
    comments?: number;
  };
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "publisherId" in value &&
    "editionId" in value &&
    "pageId" in value &&
    typeof value.id === "string" &&
    typeof value.publisherId === "string" &&
    typeof value.editionId === "string" &&
    typeof value.pageId === "string"
  );
}

async function setRoleClaims(userId: string, role: string, publisherIds: string[]) {
  try {
    const user = await auth.getUser(userId);
    const existingPublisherIds = Array.isArray(user.customClaims?.publisherIds)
      ? user.customClaims.publisherIds
      : [];

    await auth.setCustomUserClaims(userId, {
      ...user.customClaims,
      role,
      publisherIds: [...new Set([...existingPublisherIds, ...publisherIds])],
    });
  } catch {
    console.warn(
      `Skipped custom claims for ${userId}; create the Firebase Auth user first.`,
    );
  }
}

async function main() {
  console.log(`Seeding Firestore project: ${projectId}, database: ${firestoreDatabaseId}`);
  await writeCollection("publishers", publishers);
  await deleteDocuments("publishers", legacyPublisherIds);
  await writeCollection("editionLocations", editionLocations);
  await writeCollection("editionLanguages", editionLanguages);
  await writeCollection("editions", editions);
  await writeCollection("articleBlocks", articleBlocks);
  await writeCollection("articlePosts", articles);
  await writeCollection(
    "metrics",
    metrics.map((metric) => ({ id: slugify(metric.label), ...metric })),
  );
  await writeCollection("campaigns", campaigns);
  await seedAccessFixtures();
  await seedReaderActivityFixtures();
  await publishReaderReadyEditions();
}

main().catch((error: unknown) => {
  if (isFirestoreNotFoundError(error)) {
    console.error(
      [
        `Firestore database was not found for project "${projectId}".`,
        `Create the SDK-compatible "${firestoreDatabaseId}" Firestore database in Native mode, then rerun \`npm run seed:firestore\`.`,
        "If the database already exists, verify the service account has Cloud Datastore User or Firebase Admin access.",
      ].join("\n"),
    );
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});

function isFirestoreNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 5
  );
}

function isAuthUserNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "auth/user-not-found"
  );
}
