import type { ArticlePost, Edition, UserProfile } from "../types";
import type { UserAccess } from "./userRepository";

const platformRoles = ["platform_admin", "super_admin"] as const;
const publisherRoles = [
  "agency_admin",
  "publisher_admin",
  "editor",
  "columnist",
  "moderator",
] as const;

export function canManagePlatform(profile: UserProfile | null) {
  return Boolean(profile && platformRoles.includes(profile.role as typeof platformRoles[number]));
}

export function canManagePublisher(
  profile: UserProfile | null,
  access: UserAccess,
  publisherId: string,
) {
  return (
    canManagePlatform(profile) ||
    Boolean(
      profile &&
        publisherRoles.includes(profile.role as typeof publisherRoles[number]) &&
        access.staffPublisherIds.includes(publisherId),
    )
  );
}

export function canOpenAdminWorkspace(profile: UserProfile | null, access: UserAccess) {
  return canManagePlatform(profile) || access.staffPublisherIds.length > 0;
}

export function hasPublisherSubscription(access: UserAccess, publisherId: string) {
  return access.subscriptionPublisherIds.includes(publisherId);
}

export function canReadEdition(
  edition: Edition,
  profile: UserProfile | null,
  access: UserAccess,
) {
  if (edition.status === "published" && edition.accessRule === "public") {
    return true;
  }

  if (edition.accessRule === "subscriber_only") {
    return Boolean(
      profile &&
        (hasPublisherSubscription(access, edition.publisherId) ||
          canManagePublisher(profile, access, edition.publisherId)),
    );
  }

  return canManagePublisher(profile, access, edition.publisherId);
}

export function canReadArticle(
  article: ArticlePost,
  profile: UserProfile | null,
  access: UserAccess,
) {
  if (article.status === "published" && article.accessRule === "public") {
    return true;
  }

  if (article.accessRule === "subscriber_only") {
    return Boolean(
      profile &&
        (hasPublisherSubscription(access, article.publisherId) ||
          canManagePublisher(profile, access, article.publisherId)),
    );
  }

  return canManagePublisher(profile, access, article.publisherId);
}

export function canUseDiscussion(
  article: ArticlePost,
  profile: UserProfile | null,
  access: UserAccess,
) {
  if (article.discussionRule === "disabled") {
    return false;
  }

  if (article.discussionRule === "locked") {
    return canManagePublisher(profile, access, article.publisherId);
  }

  if (article.discussionRule === "logged_in") {
    return Boolean(profile);
  }

  return Boolean(
    profile &&
      (hasPublisherSubscription(access, article.publisherId) ||
        canManagePublisher(profile, access, article.publisherId)),
  );
}
