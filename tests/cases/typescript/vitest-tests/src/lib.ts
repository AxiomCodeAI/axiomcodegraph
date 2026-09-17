export function normalize(tag: string): string {
  return tag.trim().toLowerCase();
}

export function shout(tag: string): string {
  return normalize(tag).toUpperCase();
}
