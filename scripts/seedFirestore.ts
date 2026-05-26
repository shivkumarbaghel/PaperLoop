import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  articles,
  campaigns,
  editions,
  metrics,
  publishers,
} from "../src/data/mockData";

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

initializeApp({
  credential: getCredential(),
  projectId,
});

const db = getFirestore();

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
        provider: "google",
        role: "super_admin",
        status: "active",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    console.log("Seeded super admin user.");
  }

  if (staffUid) {
    await db.collection("publisherStaff").doc(`${publisherId}_${staffUid}`).set(
      {
        id: `${publisherId}_${staffUid}`,
        userId: staffUid,
        publisherId,
        role: process.env.PAPERLOOP_SEED_PUBLISHER_STAFF_ROLE ?? "publisher_admin",
        status: "active",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
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

async function main() {
  console.log(`Seeding Firestore project: ${projectId}`);
  await writeCollection("publishers", publishers);
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
        "Create the default Firestore database in Firebase Console using Native mode, then rerun `npm run seed:firestore`.",
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
