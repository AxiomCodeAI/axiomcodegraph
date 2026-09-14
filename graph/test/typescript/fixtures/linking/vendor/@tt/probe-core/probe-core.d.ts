// THE TERMINAL PACKAGE. Every callable the client actually reaches is declared here,
// and the client never writes the name `@tt/probe-core` anywhere. The only path to
// this file is the re-export in @tt/probe's barrel.
export declare function probeOf<T>(subject: T): ProbeHandle<T>;
export declare class ProbeHandle<T> {
  toBeAssignableTo(other: T): boolean;
  describe(): string;
}
export declare function probeCount(items: readonly unknown[]): number;
