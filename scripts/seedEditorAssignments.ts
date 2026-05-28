/**
 * Assigns editors to all existing Navodaya Times articlePosts and their linked
 * articleBlocks in Firestore.
 *
 * Default behaviour: topic-affinity matching, then round-robin fallback.
 *
 * Flags:
 *   --pin <name>   Force every post to the editor whose name contains <name>
 *                  (case-insensitive). E.g. --pin "Amit Verma"
 *   --dry-run      Print what would be written, no Firestore writes.
 *
 * Usage:
 *   npm run seed:editor-assignments
 *   npm run seed:editor-assignments -- --dry-run
 *   npm run seed:editor-assignments -- --pin "Amit Verma"
 *   npm run seed:editor-assignments -- --pin "Amit Verma" --dry-run
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, WriteBatch } from "firebase-admin/firestore";

loadLocalEnv();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const pinIndex = args.indexOf("--pin");
const pinName = pinIndex !== -1 ? (args[pinIndex + 1] ?? "").trim().toLowerCase() : "";

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

const PUBLISHER_ID = "navodayatimes";

interface EditorProfile {
  id: string;
  userId: string;
  name: string;
  topics: string[];
  role: string;
}

interface ArticlePost {
  id: string;
  publisherId: string;
  title?: string;
  section?: string;
  tags?: string[];
  sourceBlockId?: string;
  editorId?: string;
}

interface ArticleBlock {
  id: string;
  articlePostId?: string;
  editorId?: string;
}

const topicAffinityMap: Record<string, string[]> = {
  rajesh: ["crime", "politics", "governance", "delhi ncr", "दिल्ली", "अपराध", "राजनीति", "शासन", "police", "law", "court", "election"],
  priya: ["education", "health", "community", "शिक्षा", "स्वास्थ्य", "समुदाय", "school", "hospital", "medical", "society"],
  amit: ["opinion", "urban", "development", "policy", "शहर", "नीति", "विकास", "infrastructure", "analysis", "editorial"],
};

function scoreEditor(editor: EditorProfile, article: ArticlePost): number {
  const text = [
    article.title ?? "",
    article.section ?? "",
    ...(article.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();

  const loginHint = Object.entries(topicAffinityMap).find(([, keywords]) =>
    keywords.some((kw) => text.includes(kw)),
  );

  if (!loginHint) return 0;

  const [loginKey] = loginHint;
  const nameMatches =
    (loginKey === "rajesh" && editor.name.toLowerCase().includes("rajesh")) ||
    (loginKey === "priya" && editor.name.toLowerCase().includes("priya")) ||
    (loginKey === "amit" && editor.name.toLowerCase().includes("amit"));

  return nameMatches ? 10 : 0;
}

function pickEditor(profiles: EditorProfile[], article: ArticlePost): EditorProfile {
  const scored = profiles.map((profile) => ({
    profile,
    score: scoreEditor(profile, article),
  }));

  scored.sort((a, b) => b.score - a.score);

  if (scored[0]?.score > 0) {
    return scored[0].profile;
  }

  // round-robin fallback using stable hash of article id
  const idx = article.id
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0) % profiles.length;
  return profiles[idx];
}

async function batchCommit(batches: WriteBatch[]) {
  for (const batch of batches) {
    await batch.commit();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const suffix = [pinName ? `--pin "${pinName}"` : "", dryRun ? "[DRY RUN]" : ""]
    .filter(Boolean)
    .join(" ");
  console.log(`Seeding editor assignments for publisher: ${PUBLISHER_ID} ${suffix}`.trimEnd());

  const profilesSnap = await db
    .collection("editorProfiles")
    .where("publisherId", "==", PUBLISHER_ID)
    .where("status", "==", "active")
    .get();

  const profiles: EditorProfile[] = profilesSnap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<EditorProfile, "id">),
  }));

  if (profiles.length === 0) {
    console.error(
      "No editor profiles found for navodayatimes. Run `npm run seed:test-access` first.",
    );
    process.exitCode = 1;
    return;
  }

  // Only assign editorial staff (not moderators) to articles
  const editorialProfiles = profiles.filter((p) =>
    ["editor", "columnist", "publisher_admin"].includes(p.role),
  );

  console.log(
    `Found ${profiles.length} profiles (${editorialProfiles.length} editorial): ${editorialProfiles.map((p) => p.name).join(", ")}`,
  );

  // --pin: resolve the pinned editor once up front
  let pinnedEditor: EditorProfile | null = null;
  if (pinName) {
    pinnedEditor = editorialProfiles.find((p) =>
      p.name.toLowerCase().includes(pinName),
    ) ?? null;
    if (!pinnedEditor) {
      console.error(
        `No editorial profile found matching "--pin ${pinName}". Available: ${editorialProfiles.map((p) => p.name).join(", ")}`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`Pinned editor: ${pinnedEditor.name} (${pinnedEditor.id})`);
  }

  const postsSnap = await db
    .collection("articlePosts")
    .where("publisherId", "==", PUBLISHER_ID)
    .get();

  const posts: ArticlePost[] = postsSnap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<ArticlePost, "id">),
  }));

  console.log(`Found ${posts.length} article posts to assign.`);

  if (posts.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const BATCH_LIMIT = 490;
  let currentBatch = db.batch();
  let opCount = 0;
  const allBatches: WriteBatch[] = [currentBatch];

  function nextOp() {
    opCount++;
    if (opCount >= BATCH_LIMIT) {
      currentBatch = db.batch();
      allBatches.push(currentBatch);
      opCount = 0;
    }
    return currentBatch;
  }

  const assignmentLog: { article: string; editor: string }[] = [];

  for (const post of posts) {
    const editor = pinnedEditor ?? pickEditor(editorialProfiles, post);
    assignmentLog.push({ article: post.title ?? post.id, editor: editor.name });

    if (!dryRun) {
      nextOp().update(db.collection("articlePosts").doc(post.id), {
        editorId: editor.id,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    if (post.sourceBlockId) {
      const blockSnap = await db.collection("articleBlocks").doc(post.sourceBlockId).get();

      if (blockSnap.exists) {
        if (!dryRun) {
          nextOp().update(db.collection("articleBlocks").doc(post.sourceBlockId), {
            editorId: editor.id,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
    }
  }

  console.log("\nAssignments:");
  for (const { article, editor } of assignmentLog) {
    console.log(`  "${article}" → ${editor}`);
  }

  if (!dryRun) {
    await batchCommit(allBatches);
    console.log(`\nDone. Updated ${posts.length} article posts.`);
  } else {
    console.log("\n[DRY RUN] No writes performed.");
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
      const value = line
        .slice(separatorIndex + 1)
        .trim()
        .replace(/^["']|["']$/g, "");

      process.env[key] ??= value;
    });
}
