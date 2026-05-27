import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import type { PublisherStaffMembership } from "../src/types";

type StaffRole = PublisherStaffMembership["role"];

const staffRoles = new Set<StaffRole>([
  "agency_admin",
  "publisher_admin",
  "editor",
  "columnist",
  "moderator",
]);

loadLocalEnv();

const args = parseArgs(process.argv.slice(2));
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

const email = args.email?.trim().toLowerCase();
const uid = args.uid?.trim();
const publisherId = args.publisher?.trim();
const role = args.role?.trim() as StaffRole | undefined;
const password = args.password;
const name = args.name?.trim() ?? email ?? uid ?? "Publisher Staff";
const provider = args.provider?.trim() ?? (password ? "password" : "google");

if (args.help !== undefined) {
  printUsage();
  process.exit(0);
}

if (!uid && !email) {
  throw new Error("Pass --email or --uid.");
}

if (!publisherId) {
  throw new Error("Pass --publisher <publisherId>.");
}

if (!role || !staffRoles.has(role)) {
  throw new Error(
    `Pass --role with one of: ${[...staffRoles].join(", ")}.`,
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
  const user = await resolveUser();
  const publisherIds = Array.isArray(user.customClaims?.publisherIds)
    ? user.customClaims.publisherIds
    : [];
  const nextPublisherIds = [...new Set([...publisherIds, publisherId])];

  await auth.setCustomUserClaims(user.uid, {
    ...user.customClaims,
    role,
    publisherIds: nextPublisherIds,
  });

  await db.collection("users").doc(user.uid).set(
    {
      id: user.uid,
      name,
      email: user.email ?? email ?? null,
      avatarUrl: null,
      provider,
      role,
      status: "active",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await db.collection("publisherStaff").doc(`${publisherId}_${user.uid}`).set(
    {
      id: `${publisherId}_${user.uid}`,
      userId: user.uid,
      publisherId,
      role,
      status: "active",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  if (email) {
    await db.collection("publisherInvites").doc(`${publisherId}_${slugify(email)}`).set(
      {
        id: `${publisherId}_${slugify(email)}`,
        email,
        name,
        publisherId,
        role,
        createdBy: "grant-script",
        status: "accepted",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  console.log(
    [
      `Granted ${role} access.`,
      `Project: ${projectId}`,
      `Database: ${firestoreDatabaseId}`,
      `User: ${user.uid}`,
      `Email: ${user.email ?? email ?? "n/a"}`,
      `Publisher: ${publisherId}`,
      `Publisher claims: ${nextPublisherIds.join(", ")}`,
    ].join("\n"),
  );
}

async function resolveUser(): Promise<UserRecord> {
  if (uid) {
    return auth.getUser(uid);
  }

  if (!email) {
    throw new Error("Pass --email or --uid.");
  }

  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (!password) {
      throw new Error(
        `Firebase Auth user ${email} does not exist. Create it first or rerun with --password <temporaryPassword>.`,
        { cause: error },
      );
    }

    return auth.createUser({
      email,
      password,
      displayName: name,
      emailVerified: false,
      disabled: false,
    });
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

function parseArgs(argv: string[]) {
  const parsed: Record<string, string | undefined> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (!value.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = value.slice(2).split("=", 2);
    parsed[rawKey] =
      inlineValue ?? (argv[index + 1]?.startsWith("--") ? "true" : argv[index + 1] ?? "true");

    if (!inlineValue && argv[index + 1] && !argv[index + 1].startsWith("--")) {
      index += 1;
    }
  }

  return parsed;
}

function printUsage() {
  console.log(
    [
      "Grant publisher staff access and Firebase Auth custom claims.",
      "",
      "Usage:",
      '  npm run grant:access -- --email staff@example.com --publisher narmada-times --role editor --name "Staff Name"',
      '  npm run grant:access -- --email staff@example.com --publisher narmada-times --role editor --name "Staff Name" --password "Temporary-Password-123!"',
      "",
      "Options:",
      "  --email      Firebase Auth user email to find or create.",
      "  --uid        Firebase Auth user uid to update.",
      "  --publisher  Publisher id, for example narmada-times.",
      "  --role       agency_admin, publisher_admin, editor, columnist, or moderator.",
      "  --name       Display name stored in Firestore.",
      "  --password   Optional temporary password; creates the Auth user if missing.",
    ].join("\n"),
  );
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
