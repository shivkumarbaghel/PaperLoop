# PaperLoop

PaperLoop is a product planning repository for an India/Hindi-first digital newspaper platform.

The concept bridges traditional e-paper reading with article-level posts, subscriber community, columnist profiles, publisher analytics, digital ads, and a newspaper discovery dashboard.

## Document Pack

- `docs/01-costar-product-brief.md` - COSTAR product framing.
- `docs/02-competitive-analysis.md` - Reference product analysis and PaperLoop differentiation.
- `docs/03-product-requirements.md` - Roles, MVP requirements, workflows, metrics, and risks.
- `docs/04-goals-roadmap.md` - MVP goals, phases, KPIs, and later roadmap.
- `docs/05-system-architecture.md` - Modules, data model, flows, analytics, and revenue architecture.
- `docs/06-enablement-plugins-skills.md` - Useful plugins, future skill ideas, and execution notes.

## MVP Direction

PaperLoop starts as a publisher-first web platform where newspaper agencies upload issues, editors clip article posts from pages, readers browse e-paper editions, subscribers discuss articles, and publishers manage subscriptions, ads, analytics, and community moderation.

Native mobile apps, advanced AI/OCR automation, full social automation, affiliate marketplace, and event/webinar operations are later roadmap items after the responsive web MVP is validated.

## App Stack

- React + TypeScript with Vite.
- Firebase Auth with Google/Gmail login.
- Firestore for app data.
- Firebase Storage for PDFs, page images, clips, ad assets, and avatars.
- Firebase Hosting for deployment.

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the Firebase project values.

3. Start the app:

   ```bash
   npm run dev
   ```

4. Validate before committing:

   ```bash
   npm run lint
   npm run build
   ```

## Firebase Bootstrap Status

Current project: `paperloop-2e121`.

Verified on 2026-05-27:

- Firebase project and web app exist.
- Hosting is available.
- A Firestore database named `default` exists, but it was created with Firestore Native API data access disabled and MongoDB-compatible data access enabled. The Firebase JS SDK and Admin SDK cannot use that database.
- The SDK-compatible `(default)` Firestore database exists in `asia-south1`.
- Starter Firestore collections have been seeded: `publishers`, `editions`, `articlePosts`, `metrics`, and `campaigns`.
- Firestore and Storage rules have been deployed.
- The default Firebase Storage bucket exists: `paperloop-2e121.firebasestorage.app` in `ASIA-SOUTH1`.
- Firebase Authentication is initialized with Google and Email/Password sign-in enabled.
- The Nepro admin account is bootstrapped as a `super_admin` with Storage upload claims.
- The admin workspace includes a super-admin invite panel for recording publisher staff access requests.
- Publisher staff can move edition records between review and published states from the Admin workspace.

### Required Firebase Setup

1. Verify the SDK-compatible Firestore database without deleting the existing `default` database:

   ```bash
   firebase firestore:databases:list --project paperloop-2e121
   ```

2. Seed starter content with a service account:

   ```bash
   # Option A: place serviceAccountKey.json in the project root.
   # Option B: export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
   npm run seed:firestore
   ```

3. Verify the default Firebase Storage bucket:

   ```bash
   gcloud storage buckets describe gs://paperloop-2e121.firebasestorage.app
   ```

4. If the bucket is missing, create it in the Firebase Console:
   - Bucket: `paperloop-2e121.firebasestorage.app`
   - Location: `asia-south1`

5. Verify Google authentication in the Firebase Console:
   - Authentication > Sign-in method > Google.
   - Authorized domains should include `localhost` and `paperloop-2e121.firebaseapp.com`.

6. Deploy the security rules:

   ```bash
   firebase deploy --only firestore:rules,storage --project paperloop-2e121
   ```

7. Bootstrap authorization by setting one or more seed env vars before running the seed:

   ```bash
   export PAPERLOOP_SEED_SUPER_ADMIN_UID=google-auth-uid
   export PAPERLOOP_SEED_PUBLISHER_STAFF_UID=google-auth-uid
   export PAPERLOOP_SEED_SUBSCRIBER_UID=google-auth-uid
   export PAPERLOOP_SEED_PUBLISHER_ID=narmada-times
   npm run seed:firestore
   ```

Google login creates a locked-down `reader` profile by default. Publisher workspace access requires either a platform role on `users/{uid}` or an active `publisherStaff/{publisherId}_{uid}` document. Storage upload authorization uses Firebase Auth custom claims seeded by `npm run seed:firestore` when the matching Auth user already exists. Subscriber-only article discussions require an active `subscriptions/{uid}_{publisherId}` document or staff access.

### Grant Publisher Staff Access

The Admin screen can record a pending publisher staff invite, but Firebase Auth custom claims must be applied with the local service-account script:

```bash
npm run grant:access -- --email staff@example.com --publisher narmada-times --role publisher_admin --name "Staff Name"
```

If the Firebase Auth user does not exist yet, create an Email/Password test user in the same command:

```bash
npm run grant:access -- --email staff@example.com --publisher narmada-times --role editor --name "Staff Name" --password "Temporary-Password-123!"
```

Supported staff roles are `agency_admin`, `publisher_admin`, `editor`, `moderator`, and `columnist`.

### Firebase Troubleshooting

- `5 NOT_FOUND` from `npm run seed:firestore` usually means the SDK-compatible `(default)` Firestore database is missing.
- `FAILED_PRECONDITION: Access to this database via the Firestore in Native mode API is disabled` means a command is hitting the unusable `default` database instead of `(default)`.
- Empty Firestore collections after setup means `npm run seed:firestore` has not completed successfully.
- `CONFIGURATION_NOT_FOUND` from Auth export means Firebase Authentication still needs to be initialized in the console.
- Storage bucket creation through `gcloud storage` can fail with Firebase-managed domain ownership errors. Use Firebase Console > Storage > Get started for the default bucket.
