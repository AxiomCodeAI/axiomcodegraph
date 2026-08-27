# Legacy decorators — quarantined, not deleted

`legacy-decorators.ts.quarantined` is a complete, compiling fixture for the
**legacy** decorator dialect (`experimentalDecorators: true`): class, method,
property, accessor and — the part with no other home — **parameter** decorators,
shaped after Angular, NestJS and TypeORM.

It is parked on a non-compiled extension because of an ownership boundary, not
because it is wrong.

## Why it is parked

The repo root `tsconfig.json` compiles `src/**/*`. That sweeps this file into a
project that does **not** set `experimentalDecorators`, so TypeScript reads these
as *standard* decorators and reports TS1240 and friends. Because
`src/test/python-tests.ts` runs a project-wide `tsc --noEmit` as its first check,
those errors surfaced as a **Python suite failure** — the two language efforts are
coupled through one shared project.

Verified: with `experimentalDecorators` on (`tsconfig.json.quarantined`) the file
compiles clean under TypeScript 6.0.3. The two decorator dialects cannot share one
project; that is a property of the language, not of this fixture.

## The remedy — one line, owned by whoever owns the root project

Add to root `tsconfig.json`:

```json
"exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts",
            "src/test-data/typescript/staging"]
```

Excluding the whole staging tree is the better fix regardless: fixtures are
*inputs to a parser*, not application source. Several are deliberately pathological,
some need compiler options the app does not use (`experimentalDecorators` here,
`lib: ESNext.Disposable` for `using` declarations), and compiling them into `dist/`
ships test data in the published package. The TypeScript gate should compile the
staging tree with `staging/tsconfig.json`, which already handles the per-dialect
subprojects correctly.

Once that lands, restore with:

```bash
mv legacy-decorators.ts.quarantined legacy-decorators.ts
mv tsconfig.json.quarantined tsconfig.json
npx tsc --noEmit -p src/test-data/typescript/staging/annotations/legacy   # clean
```

## If the decision is to drop legacy decorators instead

That is a real option, but it costs specific coverage, and the cost should be
taken with open eyes rather than by default:

- **parameter decorators exist only in this dialect.** They are the sole
  TypeScript analogue of Java's `ParameterAnnotationTest.java`. Dropping legacy
  decorators means the corpus has no parameter-decorator coverage at all.
- decorators on constructor parameters are how **Angular and NestJS express
  dependency injection**, so this is not a marginal dialect in real code.
- the legacy signature shape `(target, propertyKey, descriptor)` is what the
  parser will meet in the overwhelming majority of decorator-using code in the
  wild today.

Standard decorators are covered independently and unconditionally by
`../standard-decorators.ts`, which needs no flags and compiles under the repo's
default options.
