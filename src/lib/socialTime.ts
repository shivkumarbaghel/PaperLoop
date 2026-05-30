import { useEffect, useState } from "react";

export function resolveCommentTimestamp(comment: {
  createdAtMs?: number;
  createdAt?: unknown;
}): number {
  if (typeof comment.createdAtMs === "number" && Number.isFinite(comment.createdAtMs)) {
    return comment.createdAtMs;
  }

  if (comment.createdAt && typeof comment.createdAt === "object" && "toMillis" in comment.createdAt) {
    return (comment.createdAt as { toMillis: () => number }).toMillis();
  }

  if (typeof comment.createdAt === "string") {
    if (comment.createdAt === "Just now") {
      return Date.now();
    }

    const parsed = Date.parse(comment.createdAt);
    if (Number.isFinite(parsed)) {
      return parsed;
    }

    const relative = parseRelativeCreatedAt(comment.createdAt);
    if (relative !== null) {
      return relative;
    }
  }

  return Date.now() - 3_600_000;
}

export function formatRelativeTime(timestampMs: number, now = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((now - timestampMs) / 1000));

  if (diffSec < 60) {
    return `${diffSec}s`;
  }

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m`;
  }

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return `${diffHr}h`;
  }

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) {
    return `${diffDay}d`;
  }

  return new Date(timestampMs).toLocaleDateString("en-IN", {
    month: "short",
    day: "numeric",
  });
}

export function useRelativeTime(timestampMs: number, refreshMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), refreshMs);
    return () => window.clearInterval(intervalId);
  }, [refreshMs, timestampMs]);

  return formatRelativeTime(timestampMs, now);
}

function parseRelativeCreatedAt(value: string): number | null {
  const match = value.match(
    /^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\s*ago$/i,
  );

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const unitMs =
    unit.startsWith("s")
      ? 1_000
      : unit.startsWith("m")
        ? 60_000
        : unit.startsWith("h")
          ? 3_600_000
          : 86_400_000;

  return Date.now() - amount * unitMs;
}
