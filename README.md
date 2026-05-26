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
