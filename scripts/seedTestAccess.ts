import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import type { PublisherStaffMembership, UserRole } from "../src/types";

type StaffRole = PublisherStaffMembership["role"];

interface TestAccessAccount {
  loginId: string;
  email: string;
  password: string;
  name: string;
  role: UserRole;
  publisherId?: string;
  staffRole?: StaffRole;
  bio?: string;
  topics?: string[];
}

const testPassword = process.env.PAPERLOOP_TEST_PASSWORD ?? "abc123";
const testAccounts: TestAccessAccount[] = [
  {
    loginId: "admin",
    email: "admin@paperloop.test",
    password: testPassword,
    name: "PaperLoop Admin",
    role: "super_admin",
  },
  publisherAccount("aajtak", "Aaj Tak", "aajtak"),
  publisherAccount("livehindustan", "Live Hindustan", "livehindustan"),
  publisherAccount("amarujala", "Amar Ujala", "amarujala"),
  publisherAccount("prabhatkhabar", "Prabhat Khabar", "prabhatkhabar"),
  publisherAccount("jagran", "Dainik Jagran", "jagran"),
  publisherAccount("navodayatimes", "Navodaya Times", "navodayatimes"),
  editorAccount("aajtak.editor", "Aaj Tak", "aajtak"),
  editorAccount("livehindustan.editor", "Live Hindustan", "livehindustan"),
  editorAccount("amarujala.editor", "Amar Ujala", "amarujala"),
  editorAccount("prabhatkhabar.editor", "Prabhat Khabar", "prabhatkhabar"),
  editorAccount("jagran.editor", "Dainik Jagran", "jagran"),
  editorAccount("navodayatimes.editor", "Navodaya Times", "navodayatimes"),

  // ── Aaj Tak ──────────────────────────────────────────────────────────────
  namedStaffAccount(
    "aajtak.suresh",
    "Suresh Mishra",
    "aajtak",
    "editor",
    "Suresh Mishra is a senior political editor at Aaj Tak with over 15 years covering national policy, Parliament, and government affairs.",
    ["National", "Politics", "Parliament", "Policy"],
  ),
  namedStaffAccount(
    "aajtak.kavita",
    "Kavita Singh",
    "aajtak",
    "columnist",
    "Kavita Singh writes opinion and analysis columns on India's foreign policy, diplomacy, and strategic affairs for Aaj Tak.",
    ["Opinion", "Foreign Policy", "Diplomacy", "International"],
  ),
  namedStaffAccount(
    "aajtak.rajan",
    "Rajan Tiwari",
    "aajtak",
    "editor",
    "Rajan Tiwari leads the business and economy desk at Aaj Tak, tracking markets, industry, and economic policy.",
    ["Business", "Economy", "Markets", "Finance"],
  ),

  // ── Live Hindustan ────────────────────────────────────────────────────────
  namedStaffAccount(
    "livehindustan.anita",
    "Anita Jha",
    "livehindustan",
    "editor",
    "Anita Jha is a principal editor at Live Hindustan covering Bihar and Jharkhand state politics, elections, and regional governance.",
    ["Regional", "Bihar", "Politics", "Elections"],
  ),
  namedStaffAccount(
    "livehindustan.manoj",
    "Manoj Kumar",
    "livehindustan",
    "editor",
    "Manoj Kumar reports on agriculture, rural development, and smallholder farmer issues across the Gangetic plains for Live Hindustan.",
    ["Agriculture", "Rural", "Farmers", "Development"],
  ),
  namedStaffAccount(
    "livehindustan.pooja",
    "Pooja Verma",
    "livehindustan",
    "columnist",
    "Pooja Verma writes on education policy, women empowerment, and social welfare programmes for Live Hindustan.",
    ["Education", "Women", "Social", "Policy"],
  ),

  // ── Amar Ujala ────────────────────────────────────────────────────────────
  namedStaffAccount(
    "amarujala.vivek",
    "Vivek Sharma",
    "amarujala",
    "editor",
    "Vivek Sharma is the culture and religion editor at Amar Ujala, specialising in Varanasi ghats, festivals, and Uttar Pradesh's spiritual heritage.",
    ["Culture", "Religion", "Varanasi", "Heritage"],
  ),
  namedStaffAccount(
    "amarujala.rekha",
    "Rekha Gupta",
    "amarujala",
    "editor",
    "Rekha Gupta covers local government, civic infrastructure, and community news across Uttar Pradesh for Amar Ujala.",
    ["Local", "Civic", "Uttar Pradesh", "Community"],
  ),
  namedStaffAccount(
    "amarujala.deepak",
    "Deepak Pandey",
    "amarujala",
    "columnist",
    "Deepak Pandey writes historical and heritage columns exploring the rich cultural legacy of eastern Uttar Pradesh and Varanasi for Amar Ujala.",
    ["History", "Heritage", "Art", "Literature"],
  ),

  // ── Prabhat Khabar ────────────────────────────────────────────────────────
  namedStaffAccount(
    "prabhatkhabar.ashok",
    "Ashok Singh",
    "prabhatkhabar",
    "editor",
    "Ashok Singh is a senior editor at Prabhat Khabar covering Jharkhand politics, tribal rights, and state governance.",
    ["Politics", "Jharkhand", "Tribal", "Governance"],
  ),
  namedStaffAccount(
    "prabhatkhabar.meena",
    "Meena Devi",
    "prabhatkhabar",
    "editor",
    "Meena Devi reports on agricultural markets, rural economy, and mining sector developments across Jharkhand and Bihar for Prabhat Khabar.",
    ["Agriculture", "Markets", "Rural", "Mining"],
  ),
  namedStaffAccount(
    "prabhatkhabar.sanjay",
    "Sanjay Yadav",
    "prabhatkhabar",
    "columnist",
    "Sanjay Yadav writes analytical pieces on regional infrastructure, industrial development, and employment for Prabhat Khabar.",
    ["Infrastructure", "Development", "Industry", "Employment"],
  ),

  // ── Dainik Jagran ─────────────────────────────────────────────────────────
  namedStaffAccount(
    "jagran.ramesh",
    "Ramesh Shukla",
    "jagran",
    "editor",
    "Ramesh Shukla is a veteran national affairs editor at Dainik Jagran, with deep expertise in Uttar Pradesh politics and central government policy.",
    ["National", "Politics", "Uttar Pradesh", "Policy"],
  ),
  namedStaffAccount(
    "jagran.sunita",
    "Sunita Rai",
    "jagran",
    "editor",
    "Sunita Rai heads the education and youth desk at Dainik Jagran, tracking universities, competitive exams, and career news.",
    ["Education", "Youth", "Career", "University"],
  ),
  namedStaffAccount(
    "jagran.vikram",
    "Vikram Sinha",
    "jagran",
    "columnist",
    "Vikram Sinha writes popular columns on sports, entertainment, and cultural trends for Dainik Jagran's weekend edition.",
    ["Sports", "Entertainment", "Culture", "Lifestyle"],
  ),

  // ── Navodaya Times ────────────────────────────────────────────────────────
  namedStaffAccount(
    "navodayatimes.rajesh",
    "Rajesh Kumar",
    "navodayatimes",
    "editor",
    "Rajesh Kumar is a senior editor at Navodaya Times covering crime, politics, and governance across Delhi NCR.",
    ["Crime", "Politics", "Governance", "Delhi NCR"],
  ),
  namedStaffAccount(
    "navodayatimes.priya",
    "Priya Sharma",
    "navodayatimes",
    "editor",
    "Priya Sharma leads the education and health desk at Navodaya Times, with a focus on community impact stories.",
    ["Education", "Health", "Community", "City"],
  ),
  namedStaffAccount(
    "navodayatimes.amit",
    "Amit Verma",
    "navodayatimes",
    "columnist",
    "Amit Verma writes opinion pieces on urban development, policy, and social issues for Navodaya Times.",
    ["Opinion", "Urban Development", "Policy", "Social"],
  ),
  namedStaffAccount(
    "navodayatimes.sunita",
    "Sunita Gupta",
    "navodayatimes",
    "moderator",
    "Sunita Gupta moderates reader discussions and manages community engagement for Navodaya Times.",
    ["Community", "Local"],
  ),
];
const legacyAdminEmails = ["neprotechltd@gmail.com"];

loadLocalEnv();

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

const app = initializeApp({
  credential: getCredential(),
  projectId,
});
const auth = getAuth(app);
const db = getFirestore(app, firestoreDatabaseId);

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  console.log(`Seeding test access for project: ${projectId}, database: ${firestoreDatabaseId}`);

  for (const account of testAccounts) {
    await upsertTestAccount(account);
  }

  for (const email of legacyAdminEmails) {
    await demoteLegacyAdmin(email);
  }

  console.log("Test accounts ready:");
  testAccounts.forEach((account) => {
    console.log(`- ${account.loginId} / ${account.password} (${account.email})`);
  });
}

async function upsertTestAccount(account: TestAccessAccount) {
  const user = await upsertAuthUser(account);
  const publisherIds = account.publisherId ? [account.publisherId] : testPublisherIds();

  await auth.setCustomUserClaims(user.uid, {
    ...user.customClaims,
    role: account.role,
    publisherIds,
  });

  await db.collection("users").doc(user.uid).set(
    {
      id: user.uid,
      loginId: account.loginId,
      name: account.name,
      email: account.email,
      avatarUrl: null,
      provider: "password",
      role: account.role,
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
      password: account.password,
      role: account.loginId === "admin" ? "admin" : account.staffRole,
      firebaseRole: account.role,
      publisherId: account.publisherId ?? null,
      userId: user.uid,
      status: "active",
      testingOnly: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  if (account.publisherId && account.staffRole) {
    await db.collection("publisherStaff").doc(`${account.publisherId}_${user.uid}`).set(
      {
        id: `${account.publisherId}_${user.uid}`,
        userId: user.uid,
        publisherId: account.publisherId,
        role: account.staffRole,
        status: "active",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await db.collection("publisherInvites").doc(`${account.publisherId}_${account.loginId}`).set(
      {
        id: `${account.publisherId}_${account.loginId}`,
        email: account.email,
        name: account.name,
        publisherId: account.publisherId,
        role: account.staffRole,
        createdBy: "seed-test-access",
        status: "accepted",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const isEditorialRole =
      account.staffRole === "editor" ||
      account.staffRole === "columnist" ||
      account.staffRole === "moderator" ||
      account.staffRole === "publisher_admin";

    if (isEditorialRole) {
      await db.collection("editorProfiles").doc(user.uid).set(
        {
          id: user.uid,
          userId: user.uid,
          publisherId: account.publisherId,
          name: account.name,
          bio: account.bio ?? `${account.name} covers news for ${account.publisherId}.`,
          avatarUrl: null,
          topics: account.topics ?? ["Local", "City"],
          role: account.staffRole,
          followers: 0,
          status: "active",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  }
}

async function upsertAuthUser(account: TestAccessAccount): Promise<UserRecord> {
  try {
    const user = await auth.getUserByEmail(account.email);

    return auth.updateUser(user.uid, {
      displayName: account.name,
      password: account.password,
      disabled: false,
    });
  } catch (error) {
    if (!isAuthUserNotFoundError(error)) {
      throw error;
    }

    return auth.createUser({
      email: account.email,
      password: account.password,
      displayName: account.name,
      emailVerified: true,
      disabled: false,
    });
  }
}

async function demoteLegacyAdmin(email: string) {
  try {
    const user = await auth.getUserByEmail(email);

    await auth.setCustomUserClaims(user.uid, {
      ...user.customClaims,
      role: "reader",
      publisherIds: [],
    });

    await db.collection("users").doc(user.uid).set(
      {
        id: user.uid,
        email,
        role: "reader",
        status: "active",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    console.log(`Demoted legacy admin account: ${email}`);
  } catch {
    console.log(`Legacy admin account not found, skipped: ${email}`);
  }
}

function publisherAccount(
  loginId: string,
  publisherName: string,
  publisherId: string,
): TestAccessAccount {
  return {
    loginId,
    email: `${loginId}@paperloop.test`,
    password: testPassword,
    name: `${publisherName} Publisher Admin`,
    role: "publisher_admin",
    publisherId,
    staffRole: "publisher_admin",
  };
}

function editorAccount(
  loginId: string,
  publisherName: string,
  publisherId: string,
): TestAccessAccount {
  return {
    loginId,
    email: `${loginId}@paperloop.test`,
    password: testPassword,
    name: `${publisherName} Editor`,
    role: "editor",
    publisherId,
    staffRole: "editor",
  };
}

function namedStaffAccount(
  loginId: string,
  name: string,
  publisherId: string,
  staffRole: StaffRole,
  bio: string,
  topics: string[],
): TestAccessAccount {
  const role: UserRole =
    staffRole === "publisher_admin" || staffRole === "agency_admin"
      ? staffRole
      : (staffRole as UserRole);
  return {
    loginId,
    email: `${loginId}@paperloop.test`,
    password: testPassword,
    name,
    role,
    publisherId,
    staffRole,
    bio,
    topics,
  };
}

function testPublisherIds() {
  return testAccounts
    .filter((account) => account.publisherId)
    .map((account) => account.publisherId as string);
}

function isAuthUserNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "auth/user-not-found"
  );
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
