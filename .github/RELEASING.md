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
- A self-hosted macOS arm64 runner (labels `self-hosted, macOS, ARM64`) for `darwin-arm64`.
  A real publish refuses to run without every platform `package.json` pins.
- `bash .github/scripts/protect-main.sh` (admin): requires the `CI` check on `main` and
  makes `v*` tags immutable.
