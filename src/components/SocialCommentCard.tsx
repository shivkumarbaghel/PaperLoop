import { Bookmark, Heart, MessageCircle, Share2 } from "lucide-react";
import { useState } from "react";
import { deriveUserHandle, deriveUserInitial } from "../lib/socialProfiles";
import { resolveCommentTimestamp, useRelativeTime } from "../lib/socialTime";
import type { Comment } from "../types";

interface SocialCommentCardProps {
  comment: Comment;
  compact?: boolean;
  disabled?: boolean;
  onEngage?: (type: "like" | "save" | "share" | "reply") => void;
}

export function SocialCommentCard({
  comment,
  compact = false,
  disabled = false,
  onEngage,
}: SocialCommentCardProps) {
  const createdAtMs = resolveCommentTimestamp(comment);
  const relativeTime = useRelativeTime(createdAtMs);
  const handle = deriveUserHandle(comment.userName, comment.userHandle ?? null);
  const initial = deriveUserInitial(comment.userName);
  const likes = comment.stats?.likes ?? 0;
  const shares = comment.stats?.shares ?? 0;
  const saves = comment.stats?.saves ?? 0;

  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [likeCount, setLikeCount] = useState(likes);

  function toggleLike() {
    if (disabled) {
      return;
    }

    setLiked((current) => {
      const next = !current;
      setLikeCount((count) => (next ? count + 1 : Math.max(likes, count - 1)));
      return next;
    });
    onEngage?.("like");
  }

  function toggleSave() {
    if (disabled) {
      return;
    }

    setSaved((current) => !current);
    onEngage?.("save");
  }

  return (
    <article className={`social-comment-card${compact ? " compact" : ""}`}>
      <header className="social-comment-header">
        <div className="avatar avatar-round social-comment-avatar" aria-hidden="true">
          {comment.userAvatarUrl ? <img src={comment.userAvatarUrl} alt="" /> : initial}
        </div>
        <div className="social-comment-meta">
          <div className="social-comment-identity">
            <strong>{comment.userName}</strong>
            <span className="social-comment-handle">{handle}</span>
            <span className="social-comment-dot" aria-hidden="true">
              ·
            </span>
            <time className="social-comment-time" dateTime={new Date(createdAtMs).toISOString()}>
              {relativeTime}
            </time>
          </div>
        </div>
      </header>

      <p className="social-comment-body">{comment.body}</p>

      <div className="social-comment-actions">
        <button
          type="button"
          className={liked ? "active" : ""}
          disabled={disabled}
          onClick={toggleLike}
          aria-pressed={liked}
          aria-label={likeCount > 0 ? `Like, ${likeCount.toLocaleString()} likes` : "Like"}
        >
          <Heart size={16} />
          <span className="social-comment-action-label">Like</span>
          {likeCount > 0 && (
            <span className="social-comment-action-count">{likeCount.toLocaleString()}</span>
          )}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onEngage?.("reply")}
          aria-label="Reply"
        >
          <MessageCircle size={16} />
          <span className="social-comment-action-label">Reply</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onEngage?.("share")}
          aria-label={shares > 0 ? `Share, ${shares.toLocaleString()} shares` : "Share"}
        >
          <Share2 size={16} />
          <span className="social-comment-action-label">Share</span>
          {shares > 0 && (
            <span className="social-comment-action-count">{shares.toLocaleString()}</span>
          )}
        </button>
        <button
          type="button"
          className={saved ? "active" : ""}
          disabled={disabled}
          onClick={toggleSave}
          aria-pressed={saved}
          aria-label={saves > 0 ? `Save, ${saves.toLocaleString()} saves` : "Save"}
        >
          <Bookmark size={16} />
          <span className="social-comment-action-label">Save</span>
          {saves > 0 && (
            <span className="social-comment-action-count">{saves.toLocaleString()}</span>
          )}
        </button>
      </div>
    </article>
  );
}
