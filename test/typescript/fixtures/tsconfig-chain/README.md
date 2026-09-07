# tsconfig-chain fixture

Asserts that the harness's mirror carries the tsconfig chain a package's own config
`extends`, so the parser resolves compiler options instead of defaulting them.

The golden cases cannot cover this. Each case carries its own `src/tsconfig.json` with
nothing to extend, so no case has an ancestor config to lose — which is exactly why the
defect in #240 survived a green suite.

`strict: true` is declared only in `repo/tsconfig.base.json`, one directory above
`repo/packages/pkg`. The harness mirrors the package, so a flat mirror leaves the base
outside it, the parser falls back to each option's default, and `strictBindCallApply` is
emitted `false` for every module of a project that resolves it `true`.

The fixture checks all three parts of the fix, and asserts the NEGATIVE control so it
cannot pass vacuously:

1. `tsconfig_chain.mjs --plan` names a base deep enough to hold the ancestor, the
   package's path relative to it, and the config to copy.
2. Mirrored per that plan, the parser emits `strictBindCallApply = true`.
3. Mirrored FLAT — the pre-fix behaviour — the parser emits `false`, and the mirror's
   own chain re-resolution reports the unresolved `extends`.

Part 3 is the discriminator: revert the mirror change and part 2 produces `false`, which
fails.
