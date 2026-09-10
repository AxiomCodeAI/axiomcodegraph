// A receiver whose type is the ELEMENT of a container. Both classes share the member
// name `run`, so a name match cannot pass for a resolution — the OWNER is the answer.
export class AlphaOp {
  run(x: number): number {
    return x + 1;
  }
}
export class BetaOp {
  run(x: number): number {
    return x * 2;
  }
}

export async function* alphaStream(): AsyncGenerator<AlphaOp, void, void> {
  yield new AlphaOp();
}
export function* betaSequence(): Generator<BetaOp, void, void> {
  yield new BetaOp();
}

export class AlphaSource {
  async *[Symbol.asyncIterator](): AsyncIterator<AlphaOp> {
    yield new AlphaOp();
  }
}

export async function viaForAwait(): Promise<void> {
  for await (const op of alphaStream()) op.run(1);
}

export function viaForOf(): void {
  for (const op of betaSequence()) op.run(1);
}

export async function viaCustomAsyncIterator(src: AlphaSource): Promise<void> {
  for await (const op of src) op.run(1);
}

export function viaArrayForOf(ops: AlphaOp[]): void {
  for (const op of ops) op.run(1);
}

// ── CONTROLS: these resolve today and must keep resolving ───────────────────
export async function viaAwaitedPromise(p: Promise<BetaOp>): Promise<number> {
  const op = await p;
  return op.run(1);
}

export function viaDirectNew(): number {
  return new AlphaOp().run(1);
}
