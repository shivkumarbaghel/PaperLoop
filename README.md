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

## Firebase Setup

1. Create a Firebase project and enable:
   - Authentication: Google provider.
   - Firestore Database: native mode.
   - Storage.
   - Hosting.

2. Add the web app config values to `.env` using `.env.example`.

3. Deploy the security rules:

   ```bash
   firebase deploy --only firestore:rules,storage
   ```

4. Seed starter content with a service account:

   ```bash
   # Option A: place serviceAccountKey.json in the project root.
   # Option B: export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
   npm run seed:firestore
   ```

5. Bootstrap authorization by setting one or more seed env vars before running the seed:

   ```bash
   export PAPERLOOP_SEED_SUPER_ADMIN_UID=google-auth-uid
   export PAPERLOOP_SEED_PUBLISHER_STAFF_UID=google-auth-uid
   export PAPERLOOP_SEED_SUBSCRIBER_UID=google-auth-uid
   export PAPERLOOP_SEED_PUBLISHER_ID=narmada-times
   npm run seed:firestore
   ```

Google login creates a locked-down `reader` profile by default. Publisher workspace access requires either a platform role on `users/{uid}` or an active `publisherStaff/{publisherId}_{uid}` document. Subscriber-only article discussions require an active `subscriptions/{uid}_{publisherId}` document or staff access.
