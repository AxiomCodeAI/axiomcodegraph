// Declaration merging: the ENTITY is the merged group, not any one declaration.
// An interface declared twice has the union of its members, and a call on the
// second half must resolve even though the receiver names the first.

export interface Config {
  host(): string;
}

export interface Config {
  port(): number;
}

export class AppConfig implements Config {
  host(): string {
    return "h";
  }
  port(): number {
    return 1;
  }
}

// Function + namespace merging: `helper` is callable AND has members.
export function helper(): string {
  return "h";
}
export namespace helper {
  export function nested(): string {
    return "n";
  }
}

export function drive(c: Config): string {
  // Both halves of the merged interface, through one receiver.
  return c.host() + c.port() + helper() + helper.nested();
}

// ── client -> library ────────────────────────────────────────────────────────
import { Client, build } from "../lib/merged-lib";

export function useLibrary(c: Client): string {
  // Both halves of a LIBRARY-side merged interface, plus a merged function+namespace.
  return c.get() + c.put() + build() + build.withDefaults();
}
