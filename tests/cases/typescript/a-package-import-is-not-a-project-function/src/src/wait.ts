export const POLL_MS = 1

export async function waitFor(check: () => boolean): Promise<void> {
  while (!check()) await new Promise((r) => setTimeout(r, POLL_MS))
}
