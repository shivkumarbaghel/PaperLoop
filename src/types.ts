export type UserRole =
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
  label: string;
  value: string;
  delta: string;
  tone: "good" | "warn" | "neutral";
}

export interface Campaign {
  id: string;
  name: string;
  type: "subscriber_acquisition" | "digital_ad" | "sponsored_content";
  target: string;
  spend: string;
  conversion: string;
  status: "active" | "scheduled" | "paused";
}
