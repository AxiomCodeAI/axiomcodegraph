# Releasing

One version, `package.json`'s, names everything that ships: `@axiomcode/code-graph`, the
`@axiomcode/engine-<os>-<cpu>` packages it pins, the vendored parser and every plugin manifest.

## Cutting a release

1. **Bump** in a pull request: `node .github/scripts/version.mjs set 0.2.0`
   (writes all ten locations; `check` verifies them). CI's version gate requires the bump to
   move forward and not reuse a tagged version.
2. **Merge.** `release.yml` tags the merge commit `v0.2.0` and opens a **draft** release with
   notes generated from the pull requests since the previous tag. Nothing is published yet.
3. **Publish the draft** under *Releases*. That runs `publish-npm.yml`: it checks the tag
   against every manifest, builds every language's engine on every platform, publishes the
   engine packages and then `@axiomcode/code-graph`, and attaches the tarballs to the release.
   A version containing `-` (`0.2.0-rc.1`) is published under the `next` dist-tag, never `latest`.

A failed publish can be re-run: versions already on the registry are skipped.

To see what would ship without publishing: *Actions → publish-npm → Run workflow* (dry run by
default); the packed tarballs are uploaded as a workflow artifact.

## When a pull request needs a bump

Once a version is tagged, any change to a file that reaches users (everything outside the
`!` entries of `package.json`'s `files`, `graph/test/` and `.github/`) needs a new version, since
npm will not republish one. Before the first tag, changes simply join the unreleased version.

## One-time setup

- `CLI_BINARY_PUBLISH` repository secret: an npm token with publish rights on `@axiomcode`.
- The repository must be public: every platform, macOS included, builds on GitHub's standard
  hosted runners, which are free only for public repositories.
- `bash .github/scripts/protect-main.sh` (admin): PR + green `CI` for everyone, only admins merge,
  makes `v*` tags immutable.

## dev and main

`dev` is the default branch: every pull request lands there, and CI runs build, repo checks and
the five language suites on it (a docs-only change runs only the first two). Its one rule is that
it cannot be deleted, so direct pushes are fine too.

`main` moves only by promotion: a pull request `dev → main`, which also builds every platform's
engines, needs a green `CI`, and only an admin can merge. Every version released is a tag on
`main`. main only squash-merges, so after every push to main the `sync-dev` job in `release.yml`
merges main back into dev; a hotfix that conflicts with dev pushes nothing and opens an issue with
the commands to resolve it by hand.

## Nightly

`nightly.yml` builds `dev` from scratch each night it has new commits: no cached engines, the five
suites, all four platforms' engines, then `e2e-install.sh` packs the npm tarballs, installs them
into an empty project without Soufflé and runs `axiomcode` in every language, and `npm publish
--dry-run` checks each package. It publishes nothing. A failure opens an issue; the next green
night closes it. Run it by hand from Actions at any time.

## Caches

Compiled engines are cached by ENGINE_ID, the hash of a language's rules and the Soufflé version,
so a change that touches no rules reuses every engine and a rule change recompiles only its own
language. The nightly and every real publish build fresh.
