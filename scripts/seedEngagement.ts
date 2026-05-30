/**
 * Seeds realistic comments, likes, saves and shares for every published
 * articlePost in Firestore, and updates each post's stats counters.
 *
 * Safe to re-run — all IDs are deterministic so writes are idempotent.
 *
 * Usage:
 *   npm run seed:engagement
 *   npm run seed:engagement -- --dry-run
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, type WriteBatch } from "firebase-admin/firestore";

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
const auth = getAuth(app);

// ─── Reader personas ───────────────────────────────────────────────────────────

const readerAccounts = [
  { loginId: "reader-priya", email: "reader-priya@paperloop.test", name: "Priya Reader", handle: "priya_reads" },
  { loginId: "reader-aman", email: "reader-aman@paperloop.test", name: "Aman Delhi", handle: "aman_delhi" },
  { loginId: "reader-neha", email: "reader-neha@paperloop.test", name: "Neha Subscriber", handle: "neha_subscriber" },
  { loginId: "reader-ravi", email: "reader-ravi@paperloop.test", name: "Ravi Sharma", handle: "ravi_sharma" },
  { loginId: "reader-sunil", email: "reader-sunil@paperloop.test", name: "Sunil Mishra", handle: "sunil_mishra" },
  { loginId: "reader-anjali", email: "reader-anjali@paperloop.test", name: "Anjali Tiwari", handle: "anjali_tiwari" },
  { loginId: "reader-deepak", email: "reader-deepak@paperloop.test", name: "Deepak Jha", handle: "deepak_jha" },
  { loginId: "reader-meenu", email: "reader-meenu@paperloop.test", name: "Meenu Agarwal", handle: "meenu_agarwal" },
  { loginId: "reader-tarun", email: "reader-tarun@paperloop.test", name: "Tarun Singh", handle: "tarun_singh" },
  { loginId: "reader-kavya", email: "reader-kavya@paperloop.test", name: "Kavya Shukla", handle: "kavya_shukla" },
  { loginId: "reader-mohit", email: "reader-mohit@paperloop.test", name: "Mohit Rawat", handle: "mohit_rawat" },
  { loginId: "reader-pooja", email: "reader-pooja@paperloop.test", name: "Pooja Dixit", handle: "pooja_dixit" },
];

// ─── Comment bank (Hindi/Hinglish/English mix) ────────────────────────────────

const commentsBySection: Record<string, { body: string; sentiment: "positive" | "neutral" | "concern" }[]> = {
  politics: [
    { body: "Yeh khabar bahut zaroori hai. Sarkar ko is par dhyan dena chahiye.", sentiment: "concern" },
    { body: "Accha analysis. Lekin ground reality alag hoti hai.", sentiment: "neutral" },
    { body: "Is mudde par media ka dhyan dena important tha. Shukriya.", sentiment: "positive" },
    { body: "Kya sirf bade shehar tak hi sima rahe? Gaon ka kya?", sentiment: "concern" },
    { body: "Balanced coverage. Dono paksh clearly samjhaya.", sentiment: "positive" },
    { body: "नेताओं को जनता के प्रति जवाबदेह होना चाहिए।", sentiment: "concern" },
    { body: "Election se pehle waade, election ke baad maun. Yahi hota hai.", sentiment: "concern" },
    { body: "Opposition ka reaction bhi cover karo — sirf sarkar ka side mat dikhao.", sentiment: "neutral" },
    { body: "Bahut important khabar hai. Sabko share karni chahiye.", sentiment: "positive" },
    { body: "Agar niti sahi hai to implementation par focus karo.", sentiment: "neutral" },
    { body: "जनता तो बस देखती रहती है, बदलाव कब आएगा?", sentiment: "concern" },
    { body: "Yeh decision long-term mein kitna effective hoga, dekhna hoga.", sentiment: "neutral" },
  ],
  crime: [
    { body: "Aisi ghatnaon par police ko strict action lena chahiye.", sentiment: "concern" },
    { body: "Itne crime ho rahe hain, locality mein darr ka mahol hai.", sentiment: "concern" },
    { body: "Iska update milta rahe. Case track karna zaroori hai.", sentiment: "neutral" },
    { body: "Bahut hi durbhagyapurn ghatna hai. Prayers for the family.", sentiment: "concern" },
    { body: "Is area mein CCTV aur patrol badhayi jaaye.", sentiment: "concern" },
    { body: "पुलिस की तत्परता सराहनीय है। जल्द न्याय मिलना चाहिए।", sentiment: "positive" },
    { body: "Yeh pehli baar nahi hua. Systemic change chahiye.", sentiment: "concern" },
    { body: "Victims ke parivaron ko support milna chahiye — sirf khabar nahi.", sentiment: "concern" },
    { body: "Court mein case kitna jaldi chalega? Wahi asali sawaal hai.", sentiment: "neutral" },
    { body: "महिलाओं की सुरक्षा के लिए और कड़े कदम उठाने होंगे।", sentiment: "concern" },
    { body: "Criminals ko fast track court mein sentence hona chahiye.", sentiment: "concern" },
    { body: "Reporting achhi hai. Evidence preserve hona chahiye.", sentiment: "neutral" },
  ],
  education: [
    { body: "Hamare area mein bhi yahi haal hai. Schools ki halat theek karni chahiye.", sentiment: "concern" },
    { body: "Good initiative. Students ke liye ye decision sahi hai.", sentiment: "positive" },
    { body: "Result aane ke baad actual picture clear hogi.", sentiment: "neutral" },
    { body: "Teachers ki bhi training honi chahiye, sirf syllabus nahi.", sentiment: "neutral" },
    { body: "Sabse pehle infrastructure theek karo, baki baad mein.", sentiment: "concern" },
    { body: "सरकारी स्कूलों में शिक्षा की गुणवत्ता सुधारना जरूरी है।", sentiment: "concern" },
    { body: "Private school waale hamesha fees badhate hain. Regulation chahiye.", sentiment: "concern" },
    { body: "Digital education ka rollout slow hai. Internet bhi sab jagah nahi.", sentiment: "concern" },
    { body: "Scholarship schemes bahut helpful hoti hain agar sahi se implement ho.", sentiment: "positive" },
    { body: "Mid-day meal program se attendance badhi hai — yeh ek positive sign hai.", sentiment: "positive" },
    { body: "Dropout rate kam karna education ka sabse bada challenge hai.", sentiment: "neutral" },
    { body: "बच्चों के भविष्य के लिए यह निर्णय सकारात्मक है।", sentiment: "positive" },
  ],
  health: [
    { body: "Hospitals mein doctors ki kami ek badi problem hai.", sentiment: "concern" },
    { body: "Preventive healthcare par focus hona chahiye.", sentiment: "neutral" },
    { body: "Government hospitals ka haal dekha to rone ka dil karta hai.", sentiment: "concern" },
    { body: "Awareness campaign bahut important hai is topic ke liye.", sentiment: "positive" },
    { body: "Kya NGOs bhi is cause mein participate kar sakti hain?", sentiment: "neutral" },
    { body: "दवाइयाँ महंगी हैं, गरीब मरीज क्या करें?", sentiment: "concern" },
    { body: "Ambulance response time improve karna zaroori hai.", sentiment: "concern" },
    { body: "Ayushman Bharat ka benefit asli zarooratemando tak pahunche.", sentiment: "neutral" },
    { body: "Mental health par bhi utna hi dhyan dena chahiye jitna physical par.", sentiment: "neutral" },
    { body: "ICU beds ki kami ek chronic problem hai chhote shehaon mein.", sentiment: "concern" },
    { body: "स्वास्थ्य सेवाओं का विस्तार ग्रामीण क्षेत्रों तक होना चाहिए।", sentiment: "concern" },
    { body: "Health workers ko better salary aur protection milni chahiye.", sentiment: "positive" },
  ],
  business: [
    { body: "Local businesses ke liye yeh ek bada push hai.", sentiment: "positive" },
    { body: "Market mein competition badhega lekin consumers ko faida hoga.", sentiment: "neutral" },
    { body: "Is scheme ka actual implementation dekhna abhi baaki hai.", sentiment: "neutral" },
    { body: "Small traders ke liye niti clear honi chahiye.", sentiment: "concern" },
    { body: "Investment badha to employment bhi badhegi.", sentiment: "positive" },
    { body: "GST compliance chhote dukandaron ke liye bohot complex hai.", sentiment: "concern" },
    { body: "Startup ecosystem ko aur support chahiye — especially tier 2 cities mein.", sentiment: "positive" },
    { body: "Import-export policies mein clarity lane se business confidence badhega.", sentiment: "neutral" },
    { body: "Local manufacturing ko encourage karo — imports pe depend mat raho.", sentiment: "neutral" },
    { body: "व्यापारियों के लिए नीतिगत स्थिरता बेहद जरूरी है।", sentiment: "concern" },
    { body: "E-commerce ne local market ko affect kiya hai. Solutions chahiye.", sentiment: "concern" },
    { body: "Infrastructure improvement se business costs directly kam hoti hain.", sentiment: "positive" },
  ],
  default: [
    { body: "Is story par follow-up zaroor karna. Aage kya hua pata nahi chala.", sentiment: "neutral" },
    { body: "Bahut acchi reporting. Local issues ko cover karne ke liye shukriya.", sentiment: "positive" },
    { body: "Please source aur date mention karo articles mein.", sentiment: "concern" },
    { body: "Isse aage bhi track kiya jaye — yahi asal journalism hai.", sentiment: "positive" },
    { body: "Issue real hai but solution wala angle aur chahiye.", sentiment: "neutral" },
    { body: "Good coverage. Area-wise detail bhi helpful hogi readers ke liye.", sentiment: "neutral" },
    { body: "Yeh khabar share kar raha hoon apne group mein. Important hai.", sentiment: "positive" },
    { body: "Bohot der se uthaya gaya yeh mudda. Ab action honi chahiye.", sentiment: "concern" },
    { body: "Kya prashashan ne koi response diya is par?", sentiment: "neutral" },
    { body: "हमारे इलाके में भी यही हो रहा है। कुछ तो करना पड़ेगा।", sentiment: "concern" },
    { body: "अच्छी खबर है, लेकिन जमीनी हकीकत अलग है।", sentiment: "neutral" },
    { body: "यह मुद्दा काफी समय से चल रहा है, अब समाधान जरूरी है।", sentiment: "concern" },
    { body: "Reporter ne bahut mehnat ki hai is story mein. Badhai.", sentiment: "positive" },
    { body: "Sirf khabar nahi, uska asar bhi dikhana chahiye.", sentiment: "neutral" },
    { body: "हर बार वही वादे, हर बार वही निराशा।", sentiment: "concern" },
    { body: "Is tarah ki khabarein padhke achha lagta hai ki koi to dhyan de raha hai.", sentiment: "positive" },
    { body: "Data aur statistics bhi shamil karo — zyada credible lagegi khabar.", sentiment: "neutral" },
    { body: "Affected log khud kuch bol rahe hain? Unka bhi perspective chahiye.", sentiment: "neutral" },
  ],
};

// ─── Views ranges per publisher ───────────────────────────────────────────────

const publisherViewBand: Record<string, [number, number]> = {
  aajtak:          [8000, 22000],
  jagran:          [6000, 18000],
  livehindustan:   [5000, 14000],
  amarujala:       [4500, 12000],
  prabhatkhabar:   [3500, 10000],
  navodayatimes:   [3000, 9000],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pseudoRandom(seed: number): number {
  // Simple deterministic LCG — reproducible across runs
  return ((seed * 1664525 + 1013904223) & 0x7fffffff) / 0x7fffffff;
}

function pickComments(
  article: { id: string; title?: string; section?: string; tags?: string[] },
  count: number,
): { body: string; sentiment: "positive" | "neutral" | "concern" }[] {
  const text = [article.title ?? "", article.section ?? "", ...(article.tags ?? [])]
    .join(" ")
    .toLowerCase();

  let bank = commentsBySection.default;

  if (/crime|police|अपराध|गोली|हमला|चोरी|लूट/.test(text)) bank = commentsBySection.crime;
  else if (/politics|elect|भाजपा|कांग्रेस|राजनीति|सरकार|मंत्री|विधायक|सांसद/.test(text)) bank = commentsBySection.politics;
  else if (/education|school|student|शिक्षा|विद्यालय|परीक्षा/.test(text)) bank = commentsBySection.education;
  else if (/health|hospital|doctor|स्वास्थ्य|अस्पताल|दवा/.test(text)) bank = commentsBySection.health;
  else if (/business|market|trade|व्यापार|बाज़ार|उद्योग/.test(text)) bank = commentsBySection.business;

  // Build a deterministic seed from the article ID (sum of charCodes * position)
  const articleSeed = article.id
    .split("")
    .reduce((acc, c, i) => (acc * 31 + c.charCodeAt(0) + i) & 0x7fffffff, 0);

  // Fisher-Yates shuffle with the seed — produces diverse, unique picks
  const indices = Array.from({ length: bank.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(pseudoRandom((articleSeed + i * 7793) & 0x7fffffff) * (i + 1));
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }

  return indices.slice(0, Math.min(count, bank.length)).map((i) => bank[i]!);
}

function seedDate(articleIdx: number, offsetMinutes: number): Date {
  const base = new Date("2026-05-20T06:00:00Z");
  base.setDate(base.getDate() + (articleIdx % 10));
  base.setMinutes(base.getMinutes() + offsetMinutes);
  return base;
}

async function commitBatches(batches: WriteBatch[]) {
  for (const batch of batches) {
    await batch.commit();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  console.log(`Seeding engagement for all published posts${dryRun ? " [DRY RUN]" : ""}...`);

  // Resolve reader UIDs (best-effort; virtual readers get a stable fake UID)
  const readerUsers = await Promise.all(
    readerAccounts.map(async (account) => {
      try {
        const user = await auth.getUserByEmail(account.email);
        return { ...account, uid: user.uid };
      } catch {
        // Deterministic fake UID for virtual readers not yet in Auth
        const fakeUid = `seed-${account.loginId}`;
        return { ...account, uid: fakeUid };
      }
    }),
  );

  console.log(`Resolved ${readerUsers.length} reader personas.`);

  // Load all published article posts
  const postsSnap = await db
    .collection("articlePosts")
    .where("status", "==", "published")
    .get();

  const posts = postsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as {
    id: string;
    publisherId: string;
    editionId: string;
    pageId: string;
    title?: string;
    section?: string;
    tags?: string[];
    stats?: { views?: number; likes?: number; saves?: number; shares?: number; comments?: number };
  });

  console.log(`Found ${posts.length} published article posts.`);

  if (posts.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const BATCH_LIMIT = 450;
  let currentBatch = db.batch();
  let opCount = 0;
  const allBatches: WriteBatch[] = [currentBatch];

  function nextOp(): WriteBatch {
    if (opCount >= BATCH_LIMIT) {
      currentBatch = db.batch();
      allBatches.push(currentBatch);
      opCount = 0;
    }

    opCount++;
    return currentBatch;
  }

  readerUsers.forEach((reader) => {
    nextOp().set(
      db.collection("users").doc(reader.uid),
      {
        id: reader.uid,
        loginId: reader.loginId,
        name: reader.name,
        email: reader.email,
        handle: reader.handle,
        avatarUrl: null,
        provider: "password",
        role: "reader",
        status: "active",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  let totalComments = 0;
  let totalEngagements = 0;

  posts.forEach((post, postIdx) => {
    const linkFields = {
      publisherId: post.publisherId,
      editionId: post.editionId,
      pageId: post.pageId,
      articlePostId: post.id,
    };

    const [minViews, maxViews] = publisherViewBand[post.publisherId] ?? [2000, 8000];
    const viewSeed = pseudoRandom(post.id.length * (postIdx + 1) * 7);
    const views = Math.round(minViews + viewSeed * (maxViews - minViews));

    // Pick how many readers engage with this post (3-8)
    const engagingReaders = readerUsers.slice(
      0,
      3 + Math.floor(pseudoRandom(post.id.charCodeAt(0) + postIdx) * (readerUsers.length - 3)),
    );

    // Comment count: 6–10 per post — spread across all reader personas
    const commentCount = 6 + Math.floor(pseudoRandom(post.id.charCodeAt(1) * postIdx + 1) * 5);
    const commentBodies = pickComments(post, commentCount);
    // Use the full reader pool (not just engagingReaders) so every post gets diverse voices
    const commentingReaders = readerUsers.slice(0, commentBodies.length);

    commentingReaders.forEach((reader, readerIdx) => {
      const { body, sentiment } = commentBodies[readerIdx];
      const id = `${post.id}-seed-comment-${reader.loginId}`;
      const commentSeed = pseudoRandom(post.id.charCodeAt(2) + postIdx * 17 + readerIdx * 3);
      const commentStats = {
        likes: 1 + Math.floor(commentSeed * 42),
        shares: commentSeed > 0.72 ? 1 + Math.floor(commentSeed * 4) : 0,
        saves: commentSeed > 0.45 ? 1 + Math.floor(commentSeed * 3) : 0,
      };

      nextOp().set(
        db.collection("comments").doc(id),
        {
          id,
          ...linkFields,
          userId: reader.uid,
          userName: reader.name,
          userHandle: `@${reader.handle}`,
          userAvatarUrl: null,
          body,
          sentiment,
          stats: commentStats,
          status: "published",
          createdAt: seedDate(postIdx, readerIdx * 11 + 5),
          createdAtMs: seedDate(postIdx, readerIdx * 11 + 5).getTime(),
          seededAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      // Matching comment engagement record
      const commentEngagementId = `${post.id}-seed-comment-eng-${reader.loginId}`;
      nextOp().set(
        db.collection("engagements").doc(commentEngagementId),
        {
          id: commentEngagementId,
          ...linkFields,
          userId: reader.uid,
          type: "comment",
          status: "active",
          metadata: { seed: true },
          createdAt: seedDate(postIdx, readerIdx * 11 + 6),
          seededAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      totalComments++;
      totalEngagements++;
    });

    // Engagements: all engaging readers like; alternating save/share
    let likeCount = 0;
    let saveCount = 0;
    let shareCount = 0;

    engagingReaders.forEach((reader, readerIdx) => {
      // Like — everyone
      const likeId = `${post.id}-seed-like-${reader.loginId}`;

      nextOp().set(
        db.collection("engagements").doc(likeId),
        {
          id: likeId,
          ...linkFields,
          userId: reader.uid,
          type: "like",
          status: "active",
          metadata: { seed: true },
          createdAt: seedDate(postIdx, readerIdx * 9 + 2),
          seededAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      likeCount++;
      totalEngagements++;

      // Save — every other reader
      if (readerIdx % 2 === 0) {
        const saveId = `${post.id}-seed-save-${reader.loginId}`;

        nextOp().set(
          db.collection("engagements").doc(saveId),
          {
            id: saveId,
            ...linkFields,
            userId: reader.uid,
            type: "save",
            status: "active",
            metadata: { seed: true },
            createdAt: seedDate(postIdx, readerIdx * 9 + 15),
            seededAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        saveCount++;
        totalEngagements++;
      }

      // Share — every other reader (offset)
      if (readerIdx % 2 === 1) {
        const shareId = `${post.id}-seed-share-${reader.loginId}`;

        nextOp().set(
          db.collection("engagements").doc(shareId),
          {
            id: shareId,
            ...linkFields,
            userId: reader.uid,
            type: "share",
            status: "active",
            metadata: { seed: true },
            createdAt: seedDate(postIdx, readerIdx * 9 + 22),
            seededAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        shareCount++;
        totalEngagements++;
      }
    });

    // Update articlePost stats (never decrease existing real counts)
    nextOp().set(
      db.collection("articlePosts").doc(post.id),
      {
        stats: {
          views:    Math.max(post.stats?.views    ?? 0, views),
          likes:    Math.max(post.stats?.likes    ?? 0, likeCount),
          saves:    Math.max(post.stats?.saves    ?? 0, saveCount),
          shares:   Math.max(post.stats?.shares   ?? 0, shareCount),
          comments: Math.max(post.stats?.comments ?? 0, commentingReaders.length),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    console.log(
      `  [${postIdx + 1}/${posts.length}] ${post.publisherId} — "${(post.title ?? post.id).slice(0, 50)}" ` +
      `→ ${views} views, ${likeCount} likes, ${saveCount} saves, ${shareCount} shares, ${commentingReaders.length} comments`,
    );
  });

  if (!dryRun) {
    await commitBatches(allBatches);
    console.log(
      `\nDone. ${totalComments} comments + ${totalEngagements} engagements written across ${posts.length} posts (${allBatches.length} batch(es)).`,
    );
  } else {
    console.log(
      `\n[DRY RUN] Would write ${totalComments} comments + ${totalEngagements} engagements across ${posts.length} posts.`,
    );
  }
}

// ─── Firebase helpers ─────────────────────────────────────────────────────────

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
