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
