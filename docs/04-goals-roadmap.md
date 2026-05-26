# PaperLoop Goals And Roadmap

Last updated: 2026-05-27

## North-Star Goal

Make local and regional newspapers digitally accessible, interactive, and community-driven without losing the familiar structure and trust of the daily paper.

North-star metric:

- Weekly engaged subscribers per active publisher.

Supporting definition:

- An engaged subscriber reads at least one edition page or article post and performs at least one meaningful action in a week, such as saving, sharing, commenting, following a columnist, or returning to a discussion.

## Current Implementation Status

Firebase bootstrap is the active prerequisite before continuing Phase 1 implementation.

- React/Vite app, Firebase web config, Google login code path, Firestore content fallback, security rules, and seed tooling exist.
- Project `paperloop-2e121` has an unusable Firestore database named `default`; it was created with Firestore Native API data access disabled.
- The app requires the SDK-compatible `(default)` Firestore database, the default Firebase Storage bucket, and Firebase Authentication Google provider setup.
- Creating the additional `(default)` database and Storage bucket is currently blocked until billing is enabled on the Firebase project.

After Firebase setup is verified, the next active product milestone remains Phase 1: Publisher And Edition Foundation.

## 90-Day MVP Goals

| Goal | Target outcome |
| --- | --- |
| Publisher onboarding | A pilot publisher can create an account, configure publication metadata, and upload an issue. |
| Platform administration | A super admin can manage agency admins, plans, users, analytics, and advertising settings. |
| Newspaper discovery | Readers can find leading and local newspapers by language, region, topic, popularity, and relevance. |
| E-paper reading | Readers can browse editions by date/city/section and use full-page controls. |
| Article conversion | Editors can turn page areas into article posts with corrected text and source-page links. |
| Subscriber engagement | Subscribers can save, share, comment, and follow columnists. |
| Moderation | Publishers can manage reports and keep discussions controlled. |
| Analytics | Publishers can see edition, article, subscriber, community, social reach, campaign, and revenue metrics. |

## Release Phases

### Phase 0: Product Documentation And Validation

Deliverables:

- COSTAR product brief.
- Competitive analysis.
- Product requirements.
- Goals and roadmap.
- System architecture.
- Pilot publisher interview checklist.

Exit criteria:

- MVP scope is agreed.
- Initial publisher workflow is clear.
- Key risks are documented.

### Phase 1: Publisher And Edition Foundation

Deliverables:

- Super admin console for agency creation and user/plan management.
- Publisher workspace.
- User roles for publisher admin and editor.
- Edition metadata model.
- PDF/image upload.
- Page asset generation.
- Draft/review/published edition statuses.

Exit criteria:

- A publisher can upload an issue and preview generated pages.
- Internal staff can review edition metadata before publishing.

### Phase 2: Reader E-Paper Viewer

Deliverables:

- Public publication page.
- Newspaper discovery dashboard with leading newspapers and filters for language, region, topic, popularity, and relevance.
- Date, city, edition, and section navigation.
- Page viewer with next/previous page, page number, thumbnails/list, zoom, fit page, and fullscreen.
- Share links for edition/page.

Exit criteria:

- A reader can browse a complete digital edition on desktop and mobile web.
- The page viewer covers the expected Bhaskar/Aaj Tak-style reading controls.

### Phase 3: Article Posts And Hotspots

Deliverables:

- Editor clipping tool for page regions.
- Article post creation.
- OCR/body text field with manual correction.
- Source page linkage.
- Article visibility rules.
- Article detail page.

Exit criteria:

- A reader can click a page hotspot, read the article post, and return to the source page.
- Editors can publish article posts without engineering support.

### Phase 4: Subscriber Community

Deliverables:

- Reader/subscriber accounts.
- Subscriber social profiles.
- Save article.
- Follow columnist.
- Article comments.
- Reactions.
- Subscriber-only discussion controls.
- Report content.
- Social sharing for daily e-paper links, section links, and article links.

Exit criteria:

- Subscribers can interact around article posts.
- Publishers can configure where discussion is allowed.

### Phase 5: Moderation, Monetization, Analytics

Deliverables:

- Moderator queue.
- Moderation action log.
- Basic subscription/access rules.
- Page/article ad slots and print-to-digital advertisement conversion.
- Targeted campaign setup by language, region, topic, publication, and subscriber segment.
- Publisher analytics dashboard.
- Social reach and feedback analytics.
- Revenue reporting for subscriptions and ads.

Exit criteria:

- Publishers can operate the community safely.
- Publishers can measure reader engagement and early monetization signals.

### Phase 6: Multimedia And Growth Expansion

Deliverables:

- Video and interactive graphics support for selected article posts.
- Sponsored content controls and labeling.
- Affiliate link tracking.
- Event/webinar listing and revenue tracking.
- Mobile app planning or prototype after responsive web validation.

Exit criteria:

- Multimedia improves engagement without weakening source-page traceability.
- New revenue modules have clear controls and reporting before launch.

## KPI Framework

| Area | KPI | Why it matters |
| --- | --- | --- |
| Publisher activation | Issues uploaded per publisher per week | Shows operational adoption. |
| Publishing efficiency | Median upload-to-publish time | Shows whether workflow is viable. |
| Reading engagement | Edition views and page views per reader | Shows newspaper-style browsing value. |
| Article conversion | Hotspot click-through and article opens | Shows value beyond static PDF reading. |
| Community | Comments, saves, shares, follows per subscriber | Shows subscriber engagement. |
| Social reach | Shared link reach, click-through, and conversion | Shows external growth efficiency. |
| Retention | 7-day and 30-day subscriber return rate | Shows ongoing habit formation. |
| Trust | Report rate and moderation resolution time | Shows community health. |
| Revenue | Paid subscribers, ad impressions/clicks, sponsored content, affiliates, and events | Shows business model progress. |

## Milestones

| Milestone | Definition of done |
| --- | --- |
| M1: Documentation complete | Product docs cover strategy, competitors, requirements, roadmap, and architecture. |
| M2: Admin and pilot workflow prototype | Super admin, agency admin, upload, page preview, and edition metadata can be demonstrated. |
| M3: Reader viewer and discovery prototype | A complete issue can be browsed online and newspapers can be discovered through the dashboard. |
| M4: Article post prototype | Page region clipping creates readable article posts linked to source pages. |
| M5: Community pilot | Subscribers can comment, save, follow, and report within controlled publisher settings. |
| M6: Publisher dashboard | Publisher can view edition, article, subscriber, social reach, revenue, and moderation metrics. |

## Later Roadmap

After MVP validation:

- AI-assisted article segmentation.
- Improved Hindi OCR and layout detection.
- AI summaries and topic extraction with editor approval.
- Audio narration for articles.
- Short video explainers and embedded multimedia.
- Native mobile apps.
- Offline reading.
- Advanced recommendations.
- Cross-publisher discovery.
- Advanced ad marketplace.
- Institutional subscriptions for schools, libraries, and offices.
- Sponsored content marketplace.
- Affiliate marketing network.
- Events and webinars platform.
- Automated content strategy recommendations.

## Acceptance Criteria For Roadmap Quality

- MVP features are separated from later enhancements.
- Every phase has a measurable exit criterion.
- Community and moderation are planned before wide-scale social growth.
- Publisher workflow is prioritized before reader-only growth features.
- Analytics exist early enough to prove publisher value.
- Subscriptions and digital ads are prioritized before secondary revenue streams.
- Responsive web is validated before native mobile app investment.
