# Verifying a run without Soufflé

This is the check that matters to someone installing the tool: **does it produce a graph on a
machine that has no Soufflé and no C++ compiler?** It takes about five minutes and needs no
prior knowledge of the engine.

If you only want the short version: install, run it on a real project, and confirm the output
says `using packaged engine`. Everything below explains how to be sure of that rather than
assume it.

## What "without Soufflé" actually means

The engine is Datalog compiled to a native binary. Building it needs Soufflé and a C++
compiler; *running* it does not. A release ships one binary per language per platform, so an
installed copy resolves a binary and never compiles.

That means there are two different claims, and it is easy to prove the weaker one by accident:

* **the binary runs** — cheap to check, and not what a user cares about
* **the pipeline runs end to end and writes a graph** — what this document checks

## 1. Install

```bash
mkdir verify && cd verify && npm init -y
npm install @axiomcode/code-graph
```

npm selects the engine package for your platform through `optionalDependencies` and `os`/`cpu`,
so you get only your own. Confirm it arrived:

```bash
ls node_modules/@axiomcode/
# code-graph   engine-<your-platform>
```

If the second entry is missing, no engine was installed and the run below will fall back to
compiling. Stop and check that your platform is published before going further.

## 2. Prove your shell really has no Soufflé

Skipping this step is the most common way to "verify" nothing. On macOS in particular, Homebrew
installs `node` and `souffle` into the **same directory**, so the obvious approach of stripping
Homebrew from `PATH` also removes `node`, and adding `node`'s directory back puts Soufflé back
with it.

Symlink just the tools you need into a clean directory:

```bash
mkdir -p /tmp/cleanbin && ln -sf "$(command -v node)" /tmp/cleanbin/node
env -i HOME="$HOME" PATH="/usr/bin:/bin:/usr/sbin:/sbin:/tmp/cleanbin" \
  sh -c 'command -v souffle >/dev/null && echo "STILL REACHABLE" || echo "souffle absent"; node --version'
```

You want `souffle absent` and a version number. If it prints `STILL REACHABLE`, the rest of this
document proves nothing.

## 3. Run it on a real project

A synthetic two-file fixture can pass while a real one fails, so use something real:

```bash
git clone --depth 1 https://github.com/apache/commons-cli /tmp/java-proj

env -i HOME="$HOME" PATH="/usr/bin:/bin:/usr/sbin:/sbin:/tmp/cleanbin" \
  ./node_modules/.bin/axiomcode /tmp/java-proj /tmp/out --language java
```

## 4. Read the output

Three things to look for, in order of how easy they are to fool yourself about.

**It used the packaged engine.** The run should print:

```
▶ using packaged engine @axiomcode/engine-<platform> (java)
```

**It did not compile.** If you see `▶ compiling souffle program (cache miss)...` then Soufflé was
reachable after all, and step 2 did not do its job.

**It wrote a non-empty graph.**

```bash
ls -la /tmp/out/java/graph.sqlite
node -e 'const {DatabaseSync}=require("node:sqlite");
  const d=new DatabaseSync("/tmp/out/java/graph.sqlite");
  console.log("tables", d.prepare("select count(*) c from sqlite_master where type = \x27table\x27").get().c);'
```

A graph that exists but holds nothing is the failure worth knowing about: the run exits 0 and
looks fine. If `call_sites` and `call_edges` are both 0 on a real project, something upstream
staged no facts.

## 5. Expected results

Measured on one real project per language, installed from the published packages, on machines
with no Soufflé:

| platform | java | typescript | python | javascript |
|---|---|---|---|---|
| linux-x64 | 19s | 11s | 36s | 12s |
| linux-arm64 | 18s | 9s | 33s | 9s |
| win32-x64 | 40s | 20s | 31s | 20s |
| darwin-arm64 | 45s | 42s | 36s | 21s |
| darwin-x64 | 15s | 11s | 32s | 19s |

Graph sizes agree across operating systems and architectures for the same input, so a result
far from these is worth investigating rather than accepting.

## Platform notes

**linux-arm64 needs a compiler to INSTALL, though not to run.** No `tree-sitter` core below
0.22 publishes a linux-arm64 prebuilt binary, and every published grammar pins the core to
0.21.x through its peer range, so npm falls back to building the parser's native dependencies
from source:

```
npm error gyp ERR! stack Error: not found: make
```

```bash
sudo apt-get install -y build-essential   # then npm install succeeds
```

This is the parser's dependency tree, not the engine. The engine binary itself needs nothing.

**Windows needs a POSIX shell.** The pipeline is bash and uses `awk`, `sort` and `shasum`. Git
for Windows supplies all of them and is enough; WSL also works. No Soufflé and no MSVC are
needed. One cosmetic difference: Git Bash cannot create real symlinks without Developer Mode,
so the fact-staging step copies instead. Correctness is unaffected; a large library costs more
disk than it would on Linux.

**Windows is 64-bit only.** `win32` in the platform name is npm's word for Windows, not a
bitness. There is no 32-bit build because Node itself no longer ships one.

## If it compiles instead of using the engine

The engine is matched by an id over the rule text, so the binary is provably the rules it was
built from rather than a near miss. A mismatch is reported rather than silently accepted:

```
! @axiomcode/engine-<platform> holds java at 16a17ec0…, these rules are d79f318c… — not using it
```

Two causes worth checking before anything else:

* **your checkout is CRLF.** On Windows without `.gitattributes`, every rule file checks out
  with CRLF, the rule text hashes differently, and a correct engine is refused. Fixed in the
  repository; an existing clone needs `git add --renormalize .` or a fresh clone.
* **your rules differ from the published ones.** Editing a rule changes the id, by design.
  Rule authors compile locally and do need Soufflé.

## What this does not check

This confirms the pipeline runs and writes a graph. It does not check that the graph is
*correct* — that is what the language suites and their oracle stages are for. A graph with
plausible row counts can still be wrong.
