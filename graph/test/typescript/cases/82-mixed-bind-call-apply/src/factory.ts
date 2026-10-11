// ============================================================================
// CASE 82 — `call` / `apply` / `bind` in a project whose tsconfigs DISAGREE
// ============================================================================
// Cases 21 and 22 each compile under ONE setting of `strictBindCallApply`. This one
// has two programs: `src/tsconfig.json` (strict) governs this file and `strict-site.ts`,
// and `src/loose/tsconfig.json` (strictBindCallApply: false) governs `loose/`. The
// same call written in each answers with a different declaration:
//
//   strict-site.ts        -> CallableFunction#bind / #call / #apply
//   loose/loose-site.ts   -> Function#bind / #call / #apply
//
// The flag is read off the module the CALL is written in, never off the module that
// declares `bind` (the library) and never as one answer for the whole project.
//
// The receivers are TYPED through a method's return, the shape that made the regime
// decide at all: `factory.get(k).bind(r)`.

export type Handler = (req: string) => string;

export class HandlerFactory {
  get(key: string): Handler {
    return (req: string) => key + req;
  }
}

export function plain(value: string): string {
  return value;
}
