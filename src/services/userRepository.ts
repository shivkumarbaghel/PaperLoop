import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseServices } from "../firebase";
import type {
  PublisherStaffMembership,
  ReaderSubscription,
  UserProfile,
} from "../types";

export interface UserAccess {
  subscriptionPublisherIds: string[];
  staffPublisherIds: string[];
}

export const emptyUserAccess: UserAccess = {
  subscriptionPublisherIds: [],
  staffPublisherIds: [],
};

export function subscribeToUserProfile(
  userId: string,
  onProfile: (profile: UserProfile | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const firebase = getFirebaseServices();

  if (!firebase) {
    onProfile(null);
    return () => undefined;
  }

  return onSnapshot(
    doc(firebase.db, "users", userId),
    (snapshot) => {
      onProfile(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as UserProfile) : null);
    },
    (error) => onError?.(error),
  );
}

export async function getUserAccess(userId: string): Promise<UserAccess> {
  const firebase = getFirebaseServices();

  if (!firebase) {
    return emptyUserAccess;
  }

  const [subscriptionSnapshot, staffSnapshot] = await Promise.all([
    getDocs(query(collection(firebase.db, "subscriptions"), where("userId", "==", userId))),
    getDocs(query(collection(firebase.db, "publisherStaff"), where("userId", "==", userId))),
  ]);

  const subscriptions = subscriptionSnapshot.docs.map((snapshot) => ({
    id: snapshot.id,
    ...snapshot.data(),
  })) as ReaderSubscription[];
  const staffMemberships = staffSnapshot.docs.map((snapshot) => ({
    id: snapshot.id,
    ...snapshot.data(),
  })) as PublisherStaffMembership[];

  return {
    subscriptionPublisherIds: subscriptions
      .filter((subscription) =>
        ["active", "trialing"].includes(subscription.status),
      )
      .map((subscription) => subscription.publisherId),
    staffPublisherIds: staffMemberships
      .filter((membership) => membership.status === "active")
      .map((membership) => membership.publisherId),
  };
}
