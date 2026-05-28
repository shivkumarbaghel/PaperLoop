import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getFirebaseServices } from "../firebase";
import type {
  PublisherStaffInvite,
  PublisherStaffMemberSummary,
  PublisherStaffMembership,
  UserProfile,
} from "../types";

export interface PublisherInviteInput {
  email: string;
  name: string;
  publisherId: string;
  role: PublisherStaffMembership["role"];
}

export async function createPublisherStaffInvite(
  input: PublisherInviteInput,
  user: User,
): Promise<PublisherStaffInvite> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  if (!email || !name || !input.publisherId || !input.role) {
    throw new Error("Name, email, publisher, and role are required.");
  }

  const inviteId = `${input.publisherId}_${slugify(email)}`;
  const invite: PublisherStaffInvite = {
    id: inviteId,
    email,
    name,
    publisherId: input.publisherId,
    role: input.role,
    status: "pending",
    createdBy: user.uid,
  };

  await setDoc(
    doc(firebase.db, "publisherInvites", inviteId),
    {
      ...invite,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );

  return invite;
}

export async function getPublisherStaffDirectory(
  publisherIds: string[],
): Promise<PublisherStaffMemberSummary[]> {
  const firebase = getFirebaseServices();

  if (!firebase || publisherIds.length === 0) {
    return [];
  }

  const snapshots = await Promise.all(
    chunk(publisherIds, 10).map((publisherIdChunk) =>
      getDocs(
        query(
          collection(firebase.db, "publisherStaff"),
          where("publisherId", "in", publisherIdChunk),
        ),
      ),
    ),
  );

  const memberships = snapshots.flatMap((snapshot) =>
    snapshot.docs.map((documentSnapshot) => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data(),
    })) as PublisherStaffMembership[],
  );

  const uniqueUserIds = [...new Set(memberships.map((membership) => membership.userId))];
  const userProfiles = await Promise.all(
    uniqueUserIds.map((userId) => getDoc(doc(firebase.db, "users", userId))),
  );
  const usersById = new Map<string, UserProfile>(
    userProfiles.flatMap((snapshot) =>
      snapshot.exists()
        ? [[snapshot.id, { id: snapshot.id, ...snapshot.data() } as UserProfile]]
        : [],
    ),
  );

  return memberships.map((membership) => {
    const userProfile = usersById.get(membership.userId);

    return {
      ...membership,
      displayName: userProfile?.name?.trim() || membership.userId,
      displayEmail: userProfile?.email ?? null,
    };
  });
}

export async function getPublisherStaffInvites(
  publisherIds: string[],
): Promise<PublisherStaffInvite[]> {
  const firebase = getFirebaseServices();

  if (!firebase || publisherIds.length === 0) {
    return [];
  }

  const snapshots = await Promise.all(
    chunk(publisherIds, 10).map((publisherIdChunk) =>
      getDocs(
        query(
          collection(firebase.db, "publisherInvites"),
          where("publisherId", "in", publisherIdChunk),
        ),
      ),
    ),
  );

  return snapshots.flatMap((snapshot) =>
    snapshot.docs.map((documentSnapshot) => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data(),
    })) as PublisherStaffInvite[],
  );
}

export async function updatePublisherStaffStatus(
  membership: PublisherStaffMembership,
  status: PublisherStaffMembership["status"],
): Promise<PublisherStaffMembership> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured.");
  }

  await updateDoc(doc(firebase.db, "publisherStaff", membership.id), {
    status,
    updatedAt: serverTimestamp(),
  });

  return {
    ...membership,
    status,
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}
