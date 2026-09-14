// TypeScript is structurally typed: a class satisfies an interface with no
// `implements` clause. A nominal engine sees none of this.

export interface Reader {
  read(): string;
}

// No `implements`, and it satisfies Reader anyway.
export class FileReader {
  read(): string {
    return "file";
  }
  close(): void {}
}

// Satisfies Reader too, and has an extra member — still assignable.
export class NetReader {
  read(): string {
    return "net";
  }
  timeout(): number {
    return 1;
  }
}

// Does NOT satisfy Reader: no read().
export class Writer {
  write(s: string): void {}
}

export function consume(r: Reader): string {
  return r.read();
}

export function drive(): string {
  const f = new FileReader();
  const n = new NetReader();
  // Structural assignability at the ARGUMENT position, not at the call.
  return consume(f) + consume(n);
}

// ── client -> library ────────────────────────────────────────────────────────
import { Closeable, drain } from "../lib/io";

export function useLibrary(): string {
  const f = new FileReader();
  // FileReader satisfies the LIBRARY's Closeable with no `implements`, and is passed
  // to a library function whose parameter is an anonymous shape.
  const c: Closeable = f;
  c.close();
  return drain(f);
}
