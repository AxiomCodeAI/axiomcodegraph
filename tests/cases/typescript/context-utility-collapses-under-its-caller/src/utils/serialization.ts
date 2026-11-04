export function toJson(obj: object): string {
  return JSON.stringify(toPlain(obj));
}

export function toPlain(obj: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith("_")));
}
