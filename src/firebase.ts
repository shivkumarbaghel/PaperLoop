import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

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

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
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
    const analytics = isSupported().then((supported) =>
      supported ? getAnalytics(app) : null,
    );

    services = { app, auth, db, storage, analytics };
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
  return signInWithPopup(firebase.auth, provider);
}

export async function signOutUser() {
  const firebase = getFirebaseServices();

  if (!firebase) {
    return;
  }

  await signOut(firebase.auth);
}
