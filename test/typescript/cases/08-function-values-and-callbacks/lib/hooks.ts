export type Hook = (s: string) => string;
export function withHook(h: Hook, s: string): string {
  return h(s);
}
export const identity: Hook = (s) => s;
