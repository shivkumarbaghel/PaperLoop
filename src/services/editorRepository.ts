import type { User } from "firebase/auth";
import {
  collection,
  doc,
  type DocumentSnapshot,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { getFirebaseServices } from "../firebase";
import type {
  ArticlePost,
  EditorFollow,
  EditorProfile,
  PublisherStaffMembership,
} from "../types";

const publisherEditorRoles: PublisherStaffMembership["role"][] = [
  "publisher_admin",
  "editor",
  "columnist",
  "moderator",
];

export async function getEditorProfile(editorId: string): Promise<EditorProfile | null> {
  const firebase = getFirebaseServices();

  if (!firebase) return null;

  const snap = await getDoc(doc(firebase.db, "editorProfiles", editorId));

  if (!snap.exists()) return null;

  const profile = { id: snap.id, ...snap.data() } as EditorProfile;

  if (profile.avatarUrl) {
    return profile;
  }

  // Try to pull avatarUrl from the users doc.  This read is restricted to the
  // owner and platform admins, so it will be denied for public visitors — that
  // is fine; we just return the profile without an avatar in that case.
  try {
    const userId = profile.userId || editorId;
    const userSnap = await getDoc(doc(firebase.db, "users", userId));

    if (userSnap.exists()) {
      const avatarUrl = (userSnap.data().avatarUrl as string | null) ?? null;
      if (avatarUrl) return { ...profile, avatarUrl };
    }
  } catch {
    // permission-denied or network error — return profile as-is
  }

  return profile;
}

export async function getPublisherEditorProfiles(publisherId: string): Promise<EditorProfile[]> {
  const firebase = getFirebaseServices();

  if (!firebase) return [];

  const [profileSnap, staffSnap] = await Promise.all([
    getDocs(
      query(
        collection(firebase.db, "editorProfiles"),
        where("publisherId", "==", publisherId),
        where("status", "==", "active"),
      ),
    ),
    getDocs(
      query(
        collection(firebase.db, "publisherStaff"),
        where("publisherId", "==", publisherId),
        where("status", "==", "active"),
      ),
    ),
  ]);

  const profilesById = new Map<string, EditorProfile>(
    profileSnap.docs.map((documentSnapshot) => [
      documentSnapshot.id,
      { id: documentSnapshot.id, ...documentSnapshot.data() } as EditorProfile,
    ]),
  );

  const staffWithoutProfiles = staffSnap.docs
    .map((documentSnapshot) => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data(),
    }))
    .filter(
      (membership): membership is PublisherStaffMembership =>
        publisherEditorRoles.includes(
          (membership as PublisherStaffMembership).role,
        ) && !profilesById.has((membership as PublisherStaffMembership).userId),
    ) as PublisherStaffMembership[];

  if (staffWithoutProfiles.length) {
    // User profile reads may be denied for non-platform-admin callers — degrade gracefully.
    let userProfiles: DocumentSnapshot[] = [];

    try {
      userProfiles = await Promise.all(
        staffWithoutProfiles.map((membership) =>
          getDoc(doc(firebase.db, "users", membership.userId)),
        ),
      );
    } catch {
      // Permission denied or network error — synthesize profiles without display names.
    }

    staffWithoutProfiles.forEach((membership, index) => {
      const userProfile = userProfiles[index];
      const userName = userProfile?.exists()
        ? ((userProfile.data().name as string | null) ?? null)
        : null;
      const avatarUrl = userProfile?.exists()
        ? ((userProfile.data().avatarUrl as string | null) ?? null)
        : null;

      profilesById.set(membership.userId, {
        id: membership.userId,
        userId: membership.userId,
        publisherId: membership.publisherId,
        name: userName?.trim() || membership.userId,
        bio: "",
        avatarUrl,
        topics: [],
        role: membership.role,
        followers: 0,
        status: "active",
      });
    });
  }

  return Array.from(profilesById.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function upsertEditorProfile(
  data: Omit<EditorProfile, "followers"> & { followers?: number },
): Promise<void> {
  const firebase = getFirebaseServices();

  if (!firebase) throw new Error("Firebase is not configured.");

  await setDoc(
    doc(firebase.db, "editorProfiles", data.id),
    {
      ...data,
      followers: data.followers ?? 0,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function getEditorFollowStatus(userId: string, editorId: string): Promise<boolean> {
  const firebase = getFirebaseServices();

  if (!firebase) return false;

  const snap = await getDoc(
    doc(firebase.db, "editorFollows", `${userId}_${editorId}`),
  );

  return snap.exists() && snap.data()?.status === "active";
}

export async function toggleEditorFollow(
  authUser: User,
  editorId: string,
  publisherId: string,
  currentlyFollowing: boolean,
): Promise<boolean> {
  const firebase = getFirebaseServices();

  if (!firebase) throw new Error("Firebase is not configured.");

  const followId = `${authUser.uid}_${editorId}`;
  const followRef = doc(firebase.db, "editorFollows", followId);
  const profileRef = doc(firebase.db, "editorProfiles", editorId);
  const nextStatus = currentlyFollowing ? "removed" : "active";
  const followerDelta = currentlyFollowing ? -1 : 1;

  await runTransaction(firebase.db, async (tx) => {
    const profileSnap = await tx.get(profileRef);
    const currentFollowers: number = profileSnap.exists()
      ? (profileSnap.data().followers ?? 0)
      : 0;

    const followData: EditorFollow = {
      id: followId,
      userId: authUser.uid,
      editorId,
      publisherId,
      status: nextStatus,
    };

    tx.set(followRef, { ...followData, updatedAt: serverTimestamp() }, { merge: true });

    if (profileSnap.exists()) {
      tx.update(profileRef, {
        followers: Math.max(0, currentFollowers + followerDelta),
        updatedAt: serverTimestamp(),
      });
    }
  });

  return !currentlyFollowing;
}

export async function getEditorArticles(editorId: string): Promise<ArticlePost[]> {
  const firebase = getFirebaseServices();

  if (!firebase) return [];

  const snap = await getDocs(
    query(
      collection(firebase.db, "articlePosts"),
      where("editorId", "==", editorId),
      where("status", "==", "published"),
    ),
  );

  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ArticlePost);
}
