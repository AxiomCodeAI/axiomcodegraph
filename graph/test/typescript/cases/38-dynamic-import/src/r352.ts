// A LITERAL `import()` NAMES ITS MODULE. The parser resolves the specifier and puts
// the target on the import row, exactly as it does for the static form beside it — but
// nothing typed the namespace the expression produces, so every call through it was
// answered `ambiguous_unknown` rather than missed, which is invisible in a per-site
// score (#352).
//
// Both modules export `run`, so a name match cannot pass for a resolution: only the
// module distinguishes alpha's from beta's.
import { run as staticRun } from './handlers/beta';

export async function viaLiteralJs(): Promise<number> {
  const mod = await import('./handlers/alpha.js');
  return mod.run(1);
}

export async function viaLiteralBare(): Promise<number> {
  const mod = await import('./handlers/beta');
  return mod.run(1);
}

export async function viaLiteralDestructured(): Promise<number> {
  const { run } = await import('./handlers/beta');
  return run(1);
}

export function viaThenCallback(): Promise<number> {
  return import('./handlers/alpha').then((m) => m.run(1));
}

// CONTROL: the same module, the same export, reached by a STATIC import.
export function ctlStaticImport(): number {
  return staticRun(1);
}

// CONTROL: a COMPUTED specifier must stay unknown. There is no resolvedFilePath, so the
// rule cannot key on one, and the blind spot stays a declared blind spot.
export async function ctlComputedSpecifier(which: string): Promise<number> {
  const mod = await import(`./handlers/${which}`);
  return mod.run(1);
}

export async function main(): Promise<number> {
  return (await viaLiteralJs()) + (await viaLiteralBare())
    + (await viaLiteralDestructured()) + (await viaThenCallback()) + ctlStaticImport();
}
