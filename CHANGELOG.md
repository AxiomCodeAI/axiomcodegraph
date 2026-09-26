# Changelog

Every release of `@axiomcode/code-graph` and its `@axiomcode/engine-<platform>` packages. The same notes are on each
[GitHub release](https://github.com/AxiomCodeAI/axiomcodegraph/releases).

## Unreleased

### Documentation
- #1372 README: what installing needs on each platform. Python 3 can be `python` or `py` on Windows, which also needs Git for Windows. On Linux arm64 the parser's native modules compile during `npm install`, so install build tools first (`sudo apt install build-essential python3`); the full `node:*` Docker images already include them `docs`

## 0.1.2 — 2026-09-26

### Improvements
- #1360 targets: one spelling works in every language. `util.square`, `src.util.square` and `src/util#square` all name the same declaration in `impact`, `path` and `context`; spellings that worked before still work, and a name that fits two declarations lists both instead of guessing `cli`
- #1352 cli: `axiomcode --version` prints the installed version `cli`

### Bugs
- #1363 windows: `impact`, `test-impact` and `changed --impact` crashed for every user without admin rights (WinError 1314) `windows`
- #1332 windows: a `git.exe`, `python.exe` or `py.exe` in the working directory was run instead of the real one, which could hang the CLI `windows`
- #1369 windows: `axiomcode path '*' …` received the directory's file names instead of `*` `windows`
- #1364 windows: `impact` could not find its query binaries in plugin installs, a console window opened on every background refresh, hooks crashed on files on another drive, WSL's bash could be picked instead of Git Bash, and library paths with spaces were split `windows`
- #1359 macOS: on Apple Silicon Macs whose `python3` is an Intel build (such as Anaconda), `impact` failed unless Soufflé was installed `macos`
- #1361 javascript: `impact` on a class imported with `require` refused it as "declared as more than one kind" `javascript`

### Build and release
- #1366 every release is tested on all five platforms (Linux x64/arm64, macOS arm64/x64, Windows x64) with every CLI verb before it is tagged `ci`
- #1350 engines are built once per release, and the exact build that passed the tests is the one published `ci`
- #1365 releases and tags are published by axiomcode-bot `ci`

## 0.1.1 — 2026-09-25

### Improvements
- #1336 graph: labels scale with zoom and never overlap, so a small repository opens as cleanly as a large one `graph`

### Bugs
- #1329 index: exits with code 127 on a clean machine because it needs the sqlite3 command-line program `index`
- #1330 impact and path need Soufflé on the user's machine: the query programs are not shipped compiled `engine`
- #1331 windows: every CLI verb and hook calls python3, which a python.org install does not provide `windows`
- #1340 windows: the index stores paths with backslashes, so context finds no scope, and every path lookup depends on the separator `windows`
- #1341 path --every: the route enumeration grows without bound on a cyclic subgraph and exhausts memory `path`
- #1345 context: a repository with its files at the root has no scope, and the refusal offers an empty list `context`
