import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  articles,
  campaigns,
  editions,
  metrics,
  publishers,
} from "../src/data/mockData";
import { editionLocations } from "../src/data/locationData";

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
  await writeCollection("editions", editions);
  await writeCollection("articlePosts", articles);
  await writeCollection(
    "metrics",
    metrics.map((metric) => ({ id: slugify(metric.label), ...metric })),
  );
  await writeCollection("campaigns", campaigns);
  await seedAccessFixtures();
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
