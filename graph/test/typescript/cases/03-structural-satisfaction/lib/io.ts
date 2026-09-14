export interface Closeable {
  close(): void;
}
export function drain(r: { read(): string }): string {
  return r.read();
}
