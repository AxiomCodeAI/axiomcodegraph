import { vend } from "../lib/shapes-lib";

// A dotted LIBRARY type in a client annotation.
export function useLibrary(h: vend.Handle): string {
  return h.open();
}

export function driveLibrary(): string {
  const h: vend.Handle = new vend.Std();
  return useLibrary(h) + h.open();
}
