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
  subscriberCount: number;
  latestEditionDate: string;
  plan: "starter" | "growth" | "enterprise";
}

export interface Edition {
  id: string;
  publisherId: string;
  title: string;
  date: string;
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
}

export interface Page {
  id: string;
  editionId: string;
  pageNumber: number;
  section: string;
  headline: string;
  subhead: string;
  hotspots: ArticleHotspot[];
}

export interface ArticleHotspot {
  id: string;
  articleId: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
  author: Columnist;
  summary: string;
  body: string;
  clippedImageTone: string;
  accessRule: AccessRule;
  discussionRule: DiscussionRule;
  stats: {
    views: number;
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
  userName: string;
  body: string;
  sentiment: "positive" | "neutral" | "concern";
  createdAt: string;
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

export interface PublisherStaffInvite {
  id: string;
  email: string;
  name: string;
  publisherId: string;
  role: PublisherStaffMembership["role"];
  status: PublisherInviteStatus;
  createdBy: string;
}
