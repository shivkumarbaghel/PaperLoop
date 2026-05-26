# PaperLoop System Architecture

Last updated: 2026-05-26

## Architecture Summary

PaperLoop should be built as a web-first platform with a publisher workspace, reader-facing e-paper experience, article/community layer, moderation tools, and analytics.

The MVP architecture should optimize for clarity and publisher workflow reliability:

- Store uploaded issue assets safely.
- Convert issues into page records.
- Let editors manually create article posts and correct OCR text.
- Link every article post back to its original edition/page/hotspot.
- Enforce access rules for free, paid, and subscriber-only content.
- Capture engagement and moderation events for analytics.

## Product Modules

| Module | Responsibilities |
| --- | --- |
| Identity And Access | User accounts, roles, publisher staff access, subscriber access, columnist verification. |
| Super Admin Console | Agency onboarding, platform plans, global users, cross-publisher analytics, platform ads, and operational controls. |
| Publisher Workspace | Publisher profile, editions, uploads, staff, settings, ads, subscription rules, analytics. |
| Newspaper Directory | Leading newspaper dashboard, language/region/topic filters, popularity/relevance ranking, newspaper profiles. |
| Ingestion Pipeline | PDF/image upload, file validation, page extraction, page asset creation, processing status. |
| E-Paper Viewer | Date/city/edition navigation, page rendering, thumbnails, zoom, fit, fullscreen, hotspots. |
| Article CMS | Article clipping, OCR/body text correction, section assignment, author/columnist linkage, publishing status. |
| Reader Experience | Browse, search/filter basics, save, share, article reading, columnist profiles. |
| Community | Subscriber social profiles, comments, reactions, follows, reports, subscriber-only discussion controls. |
| Moderation | Report queue, moderation actions, locks, audit log, publisher controls. |
| Monetization | Subscription access rules, digital ad slots, sponsored placements, affiliate/event placeholders, plan metadata. |
| Campaign Management | Targeted acquisition and advertising campaigns by region, language, topic, publication, and subscriber segment. |
| Social Distribution | Share links, social campaign parameters, reach tracking, and feedback monitoring. |
| Multimedia | Videos, galleries, embeds, interactive graphics, and enriched article content. |
| Analytics | Events, dashboards, engagement metrics, moderation metrics, subscription metrics, social reach, and revenue metrics. |

## Core Data Model

### Publisher

Represents a newspaper agency or publication group.

Fields:

- `id`
- `name`
- `slug`
- `logo_url`
- `default_language`
- `cities`
- `publications`
- `subscription_settings`
- `ad_settings`
- `ranking_settings`
- `status`
- `created_at`
- `updated_at`

Relationships:

- Has many editions.
- Has many staff users.
- Has many columnist profiles.
- Has many campaigns.
- Has analytics access.

### NewspaperListing

Represents how a publisher/publication appears in the reader discovery dashboard.

Fields:

- `id`
- `publisher_id`
- `publication_name`
- `language`
- `regions`
- `cities`
- `topics`
- `is_leading`
- `popularity_score`
- `relevance_score`
- `latest_edition_date`
- `status`
- `created_at`
- `updated_at`

Relationships:

- Belongs to publisher.
- Links to available editions, sections, and columnist profiles.

### Edition

Represents a dated newspaper issue for a city/publication.

Fields:

- `id`
- `publisher_id`
- `publication_name`
- `city`
- `language`
- `edition_date`
- `sections`
- `access_rule`
- `status`
- `published_at`
- `created_at`
- `updated_at`

Relationships:

- Belongs to publisher.
- Has many pages.
- Has many article posts through pages.

Statuses:

- `draft`
- `processing`
- `review`
- `published`
- `archived`
- `failed`

### Page

Represents one page in an edition.

Fields:

- `id`
- `edition_id`
- `page_number`
- `asset_url`
- `thumbnail_url`
- `width`
- `height`
- `section`
- `processing_status`
- `created_at`
- `updated_at`

Relationships:

- Belongs to edition.
- Has many article hotspots.
- Has many ad slots.

### ArticlePost

Represents a clipped article as a readable digital post.

Fields:

- `id`
- `publisher_id`
- `edition_id`
- `page_id`
- `columnist_id`
- `title`
- `slug`
- `section`
- `summary`
- `body_text`
- `clipped_image_url`
- `hotspot_coordinates`
- `source_page_number`
- `language`
- `discussion_rule`
- `access_rule`
- `status`
- `published_at`
- `created_at`
- `updated_at`

Relationships:

- Belongs to publisher, edition, and page.
- Optionally belongs to columnist.
- Has many comments, reactions, saves, shares, and reports.

Statuses:

- `draft`
- `review`
- `published`
- `hidden`
- `archived`

### User

Represents a platform account.

Fields:

- `id`
- `name`
- `email`
- `phone`
- `avatar_url`
- `role`
- `language_preference`
- `status`
- `created_at`
- `updated_at`

Roles:

- `platform_admin`
- `super_admin`
- `agency_admin`
- `publisher_admin`
- `editor`
- `columnist`
- `moderator`
- `subscriber`
- `reader`

### Engagement

Represents reader and community actions.

Types:

- `comment`
- `reaction`
- `save`
- `share`
- `follow`
- `report`
- `view`
- `campaign_click`
- `ad_impression`
- `ad_click`
- `feedback`

Common fields:

- `id`
- `user_id`
- `publisher_id`
- `edition_id`
- `page_id`
- `article_post_id`
- `type`
- `metadata`
- `status`
- `created_at`

### Subscription

Represents reader or publisher paid access.

Fields:

- `id`
- `user_id`
- `publisher_id`
- `plan_type`
- `access_scope`
- `payment_status`
- `starts_at`
- `ends_at`
- `created_at`
- `updated_at`

Plan types:

- `reader_free`
- `reader_paid`
- `publisher_saas`
- `institutional`

### Advertisement

Represents digital ad inventory converted from print ads or created for digital campaigns.

Fields:

- `id`
- `publisher_id`
- `edition_id`
- `page_id`
- `article_post_id`
- `campaign_id`
- `placement_type`
- `asset_url`
- `target_url`
- `targeting_rules`
- `status`
- `starts_at`
- `ends_at`
- `created_at`
- `updated_at`

### Campaign

Represents subscriber acquisition, advertising, sponsored content, or social sharing campaigns.

Fields:

- `id`
- `publisher_id`
- `name`
- `campaign_type`
- `objective`
- `targeting_rules`
- `budget`
- `status`
- `starts_at`
- `ends_at`
- `created_at`
- `updated_at`

Campaign types:

- `subscriber_acquisition`
- `digital_ad`
- `sponsored_content`
- `social_share`
- `affiliate`
- `event_webinar`

## Ingestion Flow

1. Editor creates an edition with required metadata.
2. Editor uploads PDF or page image set.
3. System validates file type, size, page count, and publisher ownership.
4. System stores original asset.
5. System creates page images and thumbnails.
6. System creates page records with processing status.
7. Optional OCR job runs and stores draft text candidates.
8. Editor reviews page output.
9. Editor clips article regions and creates article posts.
10. Editor corrects OCR/body text and assigns section, author, access, and discussion settings.
11. Publisher previews edition.
12. Publisher publishes edition and linked article posts.

## Reader Data Flow

1. Reader opens a publication, city, and date.
2. System loads published edition metadata.
3. System loads page assets and visible article hotspots.
4. Reader navigates pages or sections.
5. Reader opens an article hotspot.
6. System validates access rule.
7. System displays article post or subscription prompt.
8. Reader saves, shares, comments, reacts, follows, or reports.
9. System records engagement events for analytics and moderation.

## Newspaper Discovery Flow

1. Reader opens the PaperLoop dashboard.
2. System loads leading newspaper placements and categorized newspaper listings.
3. Reader filters by language, region, city, topic, popularity, or relevance.
4. System returns matching newspaper listings.
5. Reader selects a newspaper.
6. System opens the newspaper profile with editions, sections, article posts, and columnists.

## Access Rules

MVP content access should support:

- Public edition and public article.
- Public edition with subscriber-only article posts.
- Subscriber-only edition.
- Publisher staff-only draft/review content.
- Hidden or archived content unavailable to public readers.

Admin access should support:

- Super admin access across agencies, plans, global analytics, and platform ad settings.
- Agency admin access across publications under one agency.
- Publisher admin access within one publisher workspace.
- Staff access scoped to assigned publisher and role.

Discussion rules should support:

- Discussion disabled.
- Public comments from logged-in users.
- Subscriber-only comments.
- Columnist replies allowed or disabled.
- Locked discussion.

## Moderation Flow

1. User reports a comment or article discussion.
2. System creates a report engagement record.
3. Moderator queue groups reports by publisher and article.
4. Moderator reviews content, reporter reason, target user, and prior actions.
5. Moderator applies action: keep, hide, remove, warn, lock.
6. System writes action to audit log.
7. Publisher admin can review moderation history.

## Analytics Events

Track these MVP events:

- `newspaper_listing_viewed`
- `newspaper_selected`
- `edition_viewed`
- `page_viewed`
- `page_zoomed`
- `article_hotspot_clicked`
- `article_opened`
- `article_saved`
- `article_shared`
- `comment_created`
- `reaction_created`
- `columnist_followed`
- `content_reported`
- `moderation_action_applied`
- `subscription_started`
- `subscription_expired`
- `ad_impression`
- `ad_clicked`
- `campaign_link_clicked`
- `social_share_clicked`
- `feedback_recorded`

Dashboards should aggregate by:

- Publisher.
- Edition.
- City.
- Section.
- Page.
- Article post.
- Columnist.
- Subscriber cohort.
- Campaign.
- Advertisement.
- Revenue stream.

## Revenue Model Architecture

MVP revenue streams:

- Reader subscription for premium content, subscriber-only discussions, exclusive articles, and optional ad-free access.
- Publisher SaaS subscription for agency/admin tools, e-paper hosting, analytics, and monetization controls.
- Digital advertising for page, section, article, and dashboard placements.

Later revenue streams:

- Sponsored content with clear labeling and publisher approval.
- Affiliate links attached to relevant articles or sponsored modules.
- Events and webinars tied to current news topics, expert discussions, or columnist sessions.
- Institutional subscriptions for schools, libraries, offices, and reading rooms.

## Social And Content Strategy Analytics

The analytics layer should help publishers answer:

- Which newspapers, editions, sections, topics, and columnists drive the most readership?
- Which article posts convert page readers into subscribers?
- Which shared links drive the highest reach, click-through, and subscription conversion?
- Which comments, reports, and feedback themes require publisher response?
- Which ads and campaigns generate revenue or subscriber growth?
- Which topics should be clipped, enriched with multimedia, or promoted more often?

## Future OCR And AI Assumptions

OCR and AI should assist editors, not replace them in the MVP.

Future capabilities:

- Hindi OCR improvement through layout-aware extraction.
- Automatic article boundary detection.
- Suggested headlines and summaries.
- Suggested section/topic tags.
- Text-to-speech article audio.
- Personalized recommendations.
- Duplicate story detection across editions.
- Comment toxicity or spam assistance for moderators.

Guardrails:

- Editor approval required before AI-generated text is published.
- Keep original page image as the source of truth.
- Preserve article-to-page traceability.
- Label AI-assisted summaries if shown to readers.

## Non-Functional Requirements

- Responsive web experience for mobile and desktop.
- Fast page image loading with thumbnails and progressive loading.
- Stable links for publication, edition, page, and article post.
- Audit logs for publishing and moderation actions.
- Role-based access control for publisher workspaces.
- Data isolation between publishers.
- Secure upload validation.
- Backups for source issue assets and generated page assets.
- Accessibility basics for keyboard navigation, alt text where possible, and readable article text.

## Acceptance Criteria

- Architecture describes upload-to-publish without requiring hidden implementation decisions.
- Article posts are explicitly linked to source editions, pages, and hotspots.
- Reader flow covers date/city/section navigation, page viewing, article reading, and engagement.
- Moderation is included before open community scaling.
- Subscription and ad concepts are represented without overbuilding payment or ad-marketplace complexity in MVP.
