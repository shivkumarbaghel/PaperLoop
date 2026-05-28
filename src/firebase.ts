import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";
import {
  getAuth,
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithRedirect,
  signInWithPopup,
  signOut,
  type UserCredential,
  type Auth,
  type User,
} from "firebase/auth";
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { getFunctions, type Functions } from "firebase/functions";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { resolveLoginEmailInput } from "./config/testLoginAliases";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId,
);

const functionsRegion =
  import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION ?? "asia-south1";

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
  functions: Functions;
  analytics: Promise<Analytics | null>;
}

let services: FirebaseServices | null = null;

export function getFirebaseServices(): FirebaseServices | null {
  if (!isFirebaseConfigured) {
    return null;
  }

  if (!services) {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const storage = getStorage(app);
    const functions = getFunctions(app, functionsRegion);
    const analytics = isSupported().then((supported) =>
      supported ? getAnalytics(app) : null,
    );

    services = { app, auth, db, storage, functions, analytics };
  }

  return services;
}

export function subscribeToAuth(callback: (user: User | null) => void) {
  const firebase = getFirebaseServices();

  if (!firebase) {
    callback(null);
    return () => undefined;
  }

  return onAuthStateChanged(firebase.auth, callback);
}

export async function signInWithGoogle() {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured. Add your Firebase env values first.");
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const credential = await signInWithPopup(firebase.auth, provider);

    await syncAuthProfile(credential, "google");

    return credential;
  } catch (error) {
    if (isPopupBlockedError(error)) {
      await signInWithRedirect(firebase.auth, provider);
      return null;
    }

    throw error;
  }
}

export async function signInWithEmailPassword(email: string, password: string) {
  const firebase = getFirebaseServices();

  if (!firebase) {
    throw new Error("Firebase is not configured. Add your Firebase env values first.");
  }

  const credential = await signInWithEmailAndPassword(
    firebase.auth,
    resolveLoginEmailInput(email),
    password,
  );

  await syncAuthProfile(credential, "password");

  return credential;
}

export async function completeGoogleRedirectSignIn() {
  const firebase = getFirebaseServices();

  if (!firebase) {
    return null;
  }

  const credential = await getRedirectResult(firebase.auth);

  if (credential) {
    await syncAuthProfile(credential, "google");
  }

  return credential;
}

async function syncAuthProfile(
  credential: UserCredential,
  provider: "google" | "password",
) {
  const firebase = getFirebaseServices();

  if (!firebase) {
    return;
  }

  const userRef = doc(firebase.db, "users", credential.user.uid);
  const userSnapshot = await getDoc(userRef);

  if (userSnapshot.exists()) {
    await updateDoc(userRef, {
      name: credential.user.displayName,
      email: credential.user.email,
      avatarUrl: credential.user.photoURL,
      provider,
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(userRef, {
      id: credential.user.uid,
      name: credential.user.displayName,
      email: credential.user.email,
      avatarUrl: credential.user.photoURL,
      role: "reader",
      provider,
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

function isPopupBlockedError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "auth/popup-blocked"
  );
}

export async function signOutUser() {
  const firebase = getFirebaseServices();

  if (!firebase) {
    return;
  }

  await signOut(firebase.auth);
}
