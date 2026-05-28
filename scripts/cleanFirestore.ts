/**
 * Targeted Firestore cleanup script.
 *
 * Deletes:
 *  1. All editions + related content (articlePosts, articleBlocks, pageAssets,
 *     processingJobs) for the narmada-times publisher.
 *  2. Specific editions by title (across any publisher) + their related content.
 *
 * Usage:
 *   npm run clean:firestore
 *   npm run clean:firestore -- --dry-run   (print what would be deleted, no writes)
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

loadLocalEnv();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

const projectId =
  process.env.FIREBASE_PROJECT_ID ??
  process.env.GCLOUD_PROJECT ??
  process.env.VITE_FIREBASE_PROJECT_ID;
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const serviceAccountPath =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ?? resolve("serviceAccountKey.json");
const firestoreDatabaseId = process.env.FIRESTORE_DATABASE_ID ?? "(default)";

if (!projectId) {
  throw new Error(
    "Missing Firebase project id. Add VITE_FIREBASE_PROJECT_ID to .env or set FIREBASE_PROJECT_ID.",
  );
}

const app = initializeApp({ credential: getCredential(), projectId });
const db = getFirestore(app, firestoreDatabaseId);

const PUBLISHER_TO_PURGE = "narmada-times";

const EDITION_TITLES_TO_DELETE = [
  "OpenAI rerun test",
  "OpenAI key smoke test",
  "UI flow test 202605280140",
  "Navodaya Times - New Delhi Smoke",
];

const CONTENT_COLLECTIONS = [
  "articlePosts",
  "articleBlocks",
  "pageAssets",
  "processingJobs",
] as const;

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  console.log(`Project: ${projectId}  Database: ${firestoreDatabaseId}`);

  if (dryRun) {
    console.log("DRY RUN — no documents will be deleted.\n");
  }

  // ── 1. Purge all content for narmada-times ──────────────────────────────
  console.log(`\n[1] Purging all content for publisher "${PUBLISHER_TO_PURGE}"…`);

  const editionIds = await deleteByPublisher(PUBLISHER_TO_PURGE);

  console.log(
    `    Removed ${editionIds.length} edition(s) and all related content for ${PUBLISHER_TO_PURGE}.`,
  );

  // ── 2. Delete specific editions by title (any publisher) ─────────────────
  console.log("\n[2] Deleting specific editions by title…");

  for (const title of EDITION_TITLES_TO_DELETE) {
    await deleteEditionsByTitle(title);
  }

  console.log("\nDone.");
}

async function deleteByPublisher(publisherId: string): Promise<string[]> {
  // Collect edition IDs for this publisher first
  const editionSnap = await db
    .collection("editions")
    .where("publisherId", "==", publisherId)
    .get();

  const editionIds = editionSnap.docs.map((d) => d.id);

  // Delete per-edition content
  for (const editionId of editionIds) {
    await deleteEditionContent(editionId, `  edition ${editionId}`);
  }

  // Delete edition documents themselves
  await batchDelete(
    editionSnap.docs.map((d) => d.ref),
    `  editions for ${publisherId}`,
  );

  // Delete any remaining publisher-scoped content not tied to a specific edition
  for (const col of CONTENT_COLLECTIONS) {
    const snap = await db
      .collection(col)
      .where("publisherId", "==", publisherId)
      .get();

    await batchDelete(
      snap.docs.map((d) => d.ref),
      `  ${col} for ${publisherId} (publisher-wide)`,
    );
  }

  return editionIds;
}

async function deleteEditionsByTitle(title: string) {
  const snap = await db
    .collection("editions")
    .where("title", "==", title)
    .get();

  if (snap.empty) {
    console.log(`    No edition found with title "${title}" — skipped.`);
    return;
  }

  for (const editionDoc of snap.docs) {
    const { publisherId } = editionDoc.data() as { publisherId: string };
    console.log(
      `    Found edition "${title}" (id: ${editionDoc.id}, publisher: ${publisherId})`,
    );

    await deleteEditionContent(editionDoc.id, `    content of "${title}"`);
    await batchDelete([editionDoc.ref], `    edition doc "${title}"`);
  }
}

async function deleteEditionContent(editionId: string, label: string) {
  for (const col of CONTENT_COLLECTIONS) {
    const snap = await db
      .collection(col)
      .where("editionId", "==", editionId)
      .get();

    await batchDelete(
      snap.docs.map((d) => d.ref),
      `${label} → ${col}`,
    );
  }
}

async function batchDelete(
  refs: FirebaseFirestore.DocumentReference[],
  label: string,
) {
  if (refs.length === 0) {
    return;
  }

  console.log(`    ${dryRun ? "[dry-run] would delete" : "Deleting"} ${refs.length} doc(s) from ${label}`);

  if (dryRun) {
    return;
  }

  // Firestore batch limit is 500 operations
  for (let i = 0; i < refs.length; i += 500) {
    const batch = db.batch();

    refs.slice(i, i + 500).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
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
