export type UserRole =
  | "platform_admin"
  | "super_admin"
  | "agency_admin"
  | "publisher_admin"
  | "editor"
  | "columnist"
  | "moderator"
  | "subscriber"
  | "reader";

export type EditionStatus =
  | "draft"
  | "processing"
  | "review"
  | "published"
  | "archived"
  | "failed";

export type AccessRule = "public" | "subscriber_only" | "staff_only";

export type DiscussionRule = "disabled" | "logged_in" | "subscriber_only" | "locked";

export type AccountStatus = "active" | "suspended" | "pending";

export type SubscriptionStatus = "active" | "trialing" | "past_due" | "expired" | "canceled";

export type PublisherInviteStatus = "pending" | "accepted" | "revoked";

export interface Publisher {
  id: string;
  name: string;
  slug: string;
  language: string;
  region: string;
  city: string;
  topics: string[];
  logo: string;
  isLeading: boolean;
  popularityScore: number;
  relevanceScore: number;
  bookmarkCount: number;
  likeCount: number;
  sourceUrl?: string;
  subscriberCount: number;
  latestEditionDate: string;
  plan: "starter" | "growth" | "enterprise";
}

export interface Edition {
  id: string;
  publisherId: string;
  title: string;
  date: string;
  state?: string;
  city: string;
  language: string;
  sections: string[];
  status: EditionStatus;
  accessRule: AccessRule;
  pages: Page[];
  sourceAssetPath?: string;
  sourceAssetUrl?: string;
  sourceAssetType?: string;
  sourceAssetName?: string;
  sourceAssetSize?: number;
  createdBy?: string;
  processingJobId?: string;
  processingError?: string;
}

export interface Page {
  id: string;
  editionId: string;
  pageNumber: number;
  section: string;
  headline: string;
  subhead: string;
  hotspots: ArticleHotspot[];
  imageUrl?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  processingStatus?: "pending" | "ready" | "failed";
}

export interface ArticleHotspot {
  id: string;
  articleId: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  blockId?: string;
  clippedImageUrl?: string;
}

export interface EditorProfile {
  id: string;
  userId: string;
  publisherId: string;
  name: string;
  bio: string;
  avatarUrl: string | null;
  topics: string[];
  role: Extract<UserRole, "editor" | "columnist" | "moderator" | "publisher_admin" | "agency_admin">;
  followers: number;
  status: AccountStatus;
}

export interface EditorFollow {
  id: string;
  userId: string;
  editorId: string;
  publisherId: string;
  status: "active" | "removed";
}

export interface ArticlePost {
  id: string;
  publisherId: string;
  editionId: string;
  pageId: string;
  pageNumber: number;
  status: EditionStatus;
  title: string;
  section: string;
  city?: string;
  state?: string;
  area?: string;
  tags?: string[];
  editorId?: string;
  author: Columnist;
  summary: string;
  body: string;
  clippedImageTone: string;
  clippedImageUrl?: string;
  clippedImagePath?: string;
  sourcePageImageUrl?: string;
  sourceBlockId?: string;
  blockGeometry?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  accessRule: AccessRule;
  discussionRule: DiscussionRule;
  stats: {
    views: number;
    likes?: number;
    saves: number;
    shares: number;
    comments: number;
  };
  comments: Comment[];
  multimedia: MultimediaBlock[];
}

export interface Columnist {
  id: string;
  name: string;
  publication: string;
  topics: string[];
  bio: string;
  verified: boolean;
  followers: number;
}

export interface Comment {
  id: string;
  userId?: string;
  userName: string;
  userHandle?: string;
  userAvatarUrl?: string | null;
  body: string;
  sentiment: "positive" | "neutral" | "concern";
  createdAt?: string | unknown;
  createdAtMs?: number;
  stats?: {
    likes: number;
    shares: number;
    saves: number;
  };
}

export interface MultimediaBlock {
  type: "video" | "graphic" | "gallery";
  title: string;
  description: string;
}

export interface MetricCard {
  id?: string;
  label: string;
  value: string;
  delta: string;
  tone: "good" | "warn" | "neutral";
}

export interface Campaign {
  id: string;
  publisherId: string;
  name: string;
  type: "subscriber_acquisition" | "digital_ad" | "sponsored_content";
  target: string;
  spend: string;
  conversion: string;
  status: "active" | "scheduled" | "paused";
  advertiserName?: string;
  placementTarget?: "publisher" | "edition" | "page" | "section" | "article";
  placementRef?: string;
  budget?: string;
}

export type ArticleBlockType = "article" | "advertisement" | "photo" | "notice" | "other";

export type ArticleBlockStatus =
  | "suggested"
  | "accepted"
  | "draft"
  | "published"
  | "rejected";

export interface PageAsset {
  id: string;
  publisherId: string;
  editionId: string;
  pageId: string;
  pageNumber: number;
  imageUrl: string;
  thumbnailUrl: string;
  storagePath: string;
  thumbnailPath: string;
  width: number;
  height: number;
  status: "processing" | "ready" | "failed";
}

export interface ArticleBlock {
  id: string;
  publisherId: string;
  editionId: string;
  pageId: string;
  pageNumber: number;
  type: ArticleBlockType;
  status: ArticleBlockStatus;
  source: "ai" | "manual";
  label: string;
  title: string;
  section: string;
  summary: string;
  body: string;
  city?: string;
  state?: string;
  area?: string;
  tags?: string[];
  editorId?: string;
  authorName?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  articlePostId?: string;
  clippedImageUrl?: string;
  clippedImagePath?: string;
  createdBy?: string;
}

export interface ProcessingJob {
  id: string;
  publisherId: string;
  editionId: string;
  sourceAssetPath: string;
  status: "queued" | "processing" | "review" | "failed";
  pageCount: number;
  error?: string;
}

export interface AdvertiserCampaign extends Campaign {
  advertiserName: string;
  placementTarget: "publisher" | "edition" | "page" | "section" | "article";
  placementRef: string;
  budget: string;
}

export interface UserProfile {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: UserRole;
  provider: "google" | "password";
  status: AccountStatus;
  languagePreference?: string;
}

export interface ReaderSubscription {
  id: string;
  userId: string;
  publisherId: string;
  planType: "reader_free" | "reader_paid" | "institutional";
  status: SubscriptionStatus;
}

export interface PublisherStaffMembership {
  id: string;
  userId: string;
  publisherId: string;
  role: Extract<
    UserRole,
    "agency_admin" | "publisher_admin" | "editor" | "columnist" | "moderator"
  >;
  status: AccountStatus;
}

export interface PublisherStaffMemberSummary extends PublisherStaffMembership {
  displayName: string;
  displayEmail: string | null;
}

export interface PublisherStaffInvite {
  id: string;
  email: string;
  name: string;
  publisherId: string;
  role: PublisherStaffMembership["role"];
  status: PublisherInviteStatus;
  createdBy: string;
}
