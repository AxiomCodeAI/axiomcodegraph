export function logInfo(event: string, fields: Record<string, unknown> = {}): void {
  console.log(`${event} ${formatFields(fields)}`);
}

export function logDebug(event: string): void {
  console.debug(event);
}

export function formatFields(fields: Record<string, unknown>): string {
  return Object.keys(fields).sort().map((k) => `${k}=${String(fields[k])}`).join(" ");
}
