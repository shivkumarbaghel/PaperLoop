# PaperLoop Product Requirements

Last updated: 2026-05-26

## Product Summary

PaperLoop is a publisher-first platform for turning local and regional newspaper editions into digital e-papers with article-level posts and subscriber community features.

The MVP focuses on a Hindi-first web experience where a newspaper agency can upload an issue, create page-linked article posts, publish an edition, and let subscribers read, save, share, discuss, and follow columnists.

## User Roles

| Role | Primary needs | MVP permissions |
| --- | --- | --- |
| Super Admin | Manage the full platform, agency admins, global users, plans, analytics, ads, and platform settings. | Cross-platform management access. |
| Agency Admin | Manage one newspaper agency, publication settings, staff, subscription rules, ads, and reports. | Agency-level management access. |
| Publisher Admin | Manage agency, editions, subscriptions, ads, staff, and analytics. | Full access to publisher workspace and settings. |
| Editor | Upload issues, define pages, clip articles, correct OCR text, assign section/author, publish posts. | Content management access for assigned publisher. |
| Columnist | Maintain profile, view linked articles, respond to reader discussion where allowed. | Profile and assigned article engagement access. |
| Reader | Browse public editions, open article posts, share links, discover sections and columnists. | Public reading and limited engagement. |
| Subscriber | Access subscriber-only editions/articles/discussions, save articles, comment, follow columnists. | Paid or verified access based on subscription. |
| Moderator | Review comments/reports and apply moderation decisions. | Community moderation access. |
| Platform Admin | Manage platform-wide publishers, plans, abuse, and operational settings. | Cross-publisher platform controls. |

## MVP Feature Requirements

### Publisher Workspace

- Publisher profile with name, logo, language, city/region, publication details, and status.
- Staff management for publisher admins, editors, columnists, and moderators.
- Edition management by date, city, language, publication, and status.
- Basic subscription settings for free, paid, or subscriber-only access.
- Basic ad configuration for page-level and article-level placements.
- Agency admin tools for managing multiple publications under one newspaper group.

### Super Admin Platform Console

- Create, approve, suspend, and manage agency/publisher accounts.
- Manage platform users, agency admins, plans, and access levels.
- View cross-publisher analytics for usage, subscriptions, revenue, engagement, and moderation health.
- Configure platform-wide advertising inventory, sponsored content rules, and subscription plan templates.
- Track publisher onboarding, issue upload activity, and revenue performance.
- Candidate brand/domain names to evaluate later: `bharat-paper.in` and `e-akhabaar.in`.

### Newspaper Discovery Dashboard

- Show leading newspapers prominently on the home dashboard.
- List other newspapers by language, region, city, and topics covered.
- Rank newspapers by popularity, relevance, recency, and subscription status.
- Support search and filters for publication, language, region, topic, and edition date.
- Let users select a newspaper and open its digital e-paper, article feed, sections, and columnist pages.
- Keep smaller/local newspapers discoverable without hiding prominent brands.

### Issue Upload And Processing

- Upload a PDF or page image set for a newspaper issue.
- Capture edition metadata before publishing: date, city, language, publication name, section list, and access rule.
- Generate page records with page number and page image/PDF asset.
- Allow manual review before an edition becomes visible to readers.
- Support draft, processing, review, published, archived, and failed statuses.

### Page Viewer

- Display a full-page e-paper replica.
- Support next/previous page, page number, thumbnails or page list, zoom in/out, fit page, and fullscreen.
- Support date, city, edition, and section navigation.
- Show clickable article hotspots on the page when available.
- Preserve the ability to return from an article post to its original page.

### Article Post Creation

- Let editors draw or define article areas on a page.
- Create an article post with title, clipped image, OCR/body text, section, author/columnist, source edition, source page, and visibility.
- Allow manual text correction before publishing.
- Support article post statuses: draft, review, published, hidden, archived.
- Keep a direct link from article post to source page and page hotspot.

### Reader And Subscriber Experience

- Browse editions by date, city, publication, and section.
- Browse newspapers by language, region, topic, popularity, and relevance.
- Open article posts from page hotspots or section/topic lists.
- Save articles to a personal library.
- Share edition, page, and article links.
- Follow columnists.
- Comment on articles when discussion is enabled.
- View subscriber-only content after access validation.
- Maintain an in-platform subscriber social profile for saved stories, followed columnists, comment history, and discussion participation.
- Access a responsive website in MVP and a mobile app in a later release.

### Community And Moderation

- Article-level comments with optional subscriber-only restriction.
- Basic reactions or likes for article posts and comments.
- Report comment/post action for users.
- Moderator queue for reported content.
- Publisher-level controls for enabling/disabling comments by edition, section, or article.
- Moderation actions: keep, hide, remove, warn user, lock discussion.
- Admin tools to monitor and respond to audience feedback from article comments, reports, shares, and social integrations.

### Columnist Profiles

- Public profile with name, photo/avatar, bio, publication affiliation, language, topics, and verified badge.
- List of linked articles.
- Follow button for subscribers/readers.
- Optional ability to reply in discussions where publisher allows it.

### Analytics

- Publisher dashboard with basic counts:
  - Edition views.
  - Page views.
  - Article opens.
  - Saves and shares.
  - Subscriber count.
  - Comment count and report count.
  - Top sections and top articles.
- Export can be deferred unless needed by early publisher pilots.
- Social reach dashboard for shared article links, daily e-paper links, campaign links, and section links.
- Content strategy insights showing high-performing sections, low-engagement articles, popular columnists, feedback themes, and subscriber conversion sources.
- Revenue reporting for subscriptions, ads, sponsored content, affiliate campaigns, and events/webinars.
- Super admin analytics across publishers, agencies, plans, users, campaigns, and platform revenue.

### Advertising And Campaigns

- Convert print advertisements into digital ad placements attached to editions, pages, sections, or article posts.
- Support targeted advertising campaigns by language, region, topic, publication, subscriber segment, and behavior.
- Track impressions, clicks, conversions, and campaign revenue.
- Support sponsored content labeling and placement controls.
- Reserve affiliate links and event/webinar promotion as later monetization modules unless required by a launch partner.

### Multimedia

- Add videos, image galleries, embedded links, and interactive graphics to article posts.
- Allow publishers to enrich selected stories without requiring every article to become multimedia.
- Keep multimedia subordinate to the source newspaper article and page traceability.

### Social Media Integration

- Share daily e-paper links, section links, and article links to social platforms.
- Track engagement and reach for shared links through campaign parameters and analytics events.
- Provide publisher/admin workflows to monitor comments, feedback, and campaign performance.
- Keep third-party social posting and response automation out of MVP unless a publisher pilot explicitly requires it.

## Core Workflows

### Publisher Upload-To-Publish

1. Publisher admin or editor creates a new edition.
2. User uploads issue PDF or page images.
3. System creates page records and assets.
4. Editor reviews pages and metadata.
5. Editor clips important stories into article posts.
6. Editor corrects OCR/body text and assigns section/columnist.
7. Publisher previews page viewer and article posts.
8. Publisher publishes the edition.

### Reader Page-To-Post

1. Reader selects publication, city, and date.
2. Reader opens the e-paper page viewer.
3. Reader navigates pages and sections.
4. Reader clicks an article hotspot.
5. Reader reads the article post.
6. Reader saves, shares, comments, follows the columnist, or returns to the source page.

### Newspaper Discovery

1. Reader opens the PaperLoop dashboard.
2. System shows leading newspapers and categorized newspaper lists.
3. Reader filters by language, region, topic, popularity, or relevance.
4. Reader selects a newspaper.
5. System opens the newspaper profile with available editions, sections, article posts, and columnist profiles.

### Content Strategy Optimization

1. Publisher reviews analytics for editions, articles, shares, comments, saves, and subscriptions.
2. System highlights top-performing topics, regions, sections, authors, and campaigns.
3. Publisher identifies weak sections, negative feedback themes, or subscription drop-offs.
4. Editor/admin adjusts clipping priority, social sharing, sponsored placements, or premium content strategy.
5. Later releases can add automated recommendations after enough engagement data exists.

### Moderation

1. User reports a comment or article discussion.
2. Report appears in the moderator queue.
3. Moderator reviews content, source article, user, and report reason.
4. Moderator keeps, hides, removes, warns, or locks discussion.
5. Action is logged for publisher admin review.

## Business Goals

| Product area | Business goal |
| --- | --- |
| Publisher upload | Reduce friction for newspapers moving print editions online. |
| Page viewer | Preserve traditional newspaper reading behavior. |
| Article posts | Improve mobile readability and article-level sharing. |
| Subscriber community | Increase retention and perceived subscription value. |
| Columnist profiles | Build reader loyalty around trusted voices. |
| Analytics | Help publishers prove digital value and optimize content. |
| Ads/subscriptions | Create monetization paths beyond print sales. |
| Newspaper dashboard | Increase discovery across leading and local newspapers. |
| Social profiles and sharing | Grow reach while retaining first-party engagement data. |
| Multimedia | Make selected articles more engaging for digital readers. |
| Targeted campaigns | Increase subscriber acquisition and advertiser value. |

## Success Metrics

MVP launch metrics:

- Time from issue upload to publish.
- Percentage of pages reviewed without processing errors.
- Number of article posts created per edition.
- Article hotspot click-through rate.
- Article save/share/comment rate.
- Subscriber conversion rate from free reader sessions.
- Subscriber retention after 30 days.
- Reported comments per 1,000 comments.
- Moderator resolution time.
- Newspaper dashboard search-to-read conversion rate.
- Social share reach and click-through rate.
- Targeted campaign conversion rate.
- Subscription, ad, sponsored content, affiliate, and event revenue.

## Risks And Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| OCR quality is poor for Hindi layouts | Article posts may require too much cleanup. | Treat OCR as assistive in MVP and keep manual correction required. |
| Publishers resist workflow complexity | Onboarding slows down. | Start with simple upload, page review, and manual clipping before advanced automation. |
| Community discussions become noisy | Trust and publisher adoption suffer. | Use subscriber-only discussions, reports, moderation queues, and publisher controls. |
| Static page viewing is hard on mobile | Readers abandon the experience. | Prioritize article hotspots and readable post view. |
| Copyright or unauthorized uploads | Legal and trust risk. | Require verified publisher accounts and ownership controls before publishing. |
| Payment/subscription complexity delays MVP | Revenue testing slows. | Start with simple access rules and integrate payments after core reading flow is stable if necessary. |
| Too many monetization models dilute MVP | Product becomes hard to launch. | Prioritize subscriptions and digital ads first; treat sponsored content, affiliates, and events/webinars as later modules. |
| Social integrations increase operational load | Publisher teams may not keep up with responses. | Start with share tracking and feedback dashboards before outbound automation. |
| Ranking newspapers creates perceived unfairness | Smaller publishers may feel buried. | Separate leading placements from language/region/topic discovery and expose ranking criteria. |

## Out Of Scope For MVP

- Native iOS and Android apps.
- Fully automated article segmentation with no editor review.
- AI summaries, AI recommendations, or AI chat over articles.
- Audio news, podcasts, and video explainers.
- Advanced ad marketplace.
- Fully open cross-publisher social feed.
- Public user-generated news posting.
- Automated social media response bots.
- Full affiliate marketplace and paid event/webinar operations.
