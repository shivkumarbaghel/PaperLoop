export function deriveUserHandle(name: string, explicit?: string | null): string {
  if (explicit?.trim()) {
    const trimmed = explicit.trim();
    return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  }

  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `@${slug || "reader"}`;
}

export function deriveUserInitial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}
