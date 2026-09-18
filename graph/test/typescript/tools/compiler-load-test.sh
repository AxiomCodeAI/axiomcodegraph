#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AN UNSUPPORTED COMPILER IS A REFUSAL, NOT A TypeError — AND EVERY ENTRY POINT
# HAS TO AGREE ABOUT THAT.
#
# TypeScript 7 is the native port and its npm package ships no JavaScript compiler
# API. It exports exactly two things:
#
#     $ node -e "const ts=require('typescript'); console.log(ts.version,
#                Object.keys(ts).join(','))"
#     7.0.2  version,versionMajorMinor
#
# The ground-truth stack deliberately prefers the PROJECT's compiler, so a project
# pinned to the current major turned into `TypeError: Cannot read properties of
# undefined (reading 'fileExists')` on the first property access — after a solve that
# can take a thousand seconds. A reader who sees a stack trace goes looking for the bug
# in the oracle; the truth is that the project is unmeasurable, which is a fact about
# its pinned compiler and not a score. See issue #239.
#
# ── WHY THIS CHECKS FIVE FILES AND NOT ONE ──────────────────────────────────
# `loadTypeScript` was duplicated across tsc-oracle, tsc-envelope and lib-files — three
# byte-identical copies — while tsc_oracle_case and tsconfig_chain reached the compiler
# by a bare `import ts from 'typescript'`. A guard living in one of five places is not
# a guard: the next crash just moves to whichever entry point nobody edited. So the
# last check here is a LINT over the tree, and it fails when a new .mjs loads the
# compiler without coming through the shared loader.
#
# The refusal itself is exercised against a REAL TypeScript 7 when one can be installed
# and against a synthetic stub otherwise, so the behaviour is pinned either way.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TS_DIR="$(cd "$HERE/.." && pwd)"

fail=0; checks=0
ok(){   checks=$((checks+1)); [ -n "${COMPILER_LOAD_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

# ── a stub package that looks exactly like TypeScript 7 to a require() ──────
# Two exports and nothing else, which is what 7.0.2 actually is. Synthesised rather
# than installed so this needs no network and cannot skip.
mkdir -p "$W/stub7/node_modules/typescript"
cat > "$W/stub7/package.json" <<'EOF'
{ "name": "stub7", "version": "1.0.0" }
EOF
cat > "$W/stub7/node_modules/typescript/package.json" <<'EOF'
{ "name": "typescript", "version": "7.0.2", "main": "index.js" }
EOF
cat > "$W/stub7/node_modules/typescript/index.js" <<'EOF'
module.exports = { version: '7.0.2', versionMajorMinor: '7.0' };
EOF
mkdir -p "$W/stub7/src"
echo 'export const x = 1;' > "$W/stub7/src/a.ts"
cat > "$W/stub7/tsconfig.json" <<'EOF'
{ "compilerOptions": { "target": "es2020" }, "include": ["src"] }
EOF

# 1-3. EVERY ground-truth entry point refuses, by name, rather than crashing.
for tool in tsc-oracle tsc-envelope lib-files; do
  case "$tool" in
    lib-files) args=( "$W/stub7" ) ;;
    *)         args=( "$W/stub7" "$W/out.tsv" ) ;;
  esac
  out="$( cd "$W/stub7" && node "$TS_DIR/ground-truth/$tool.mjs" "${args[@]}" 2>&1 )"
  rc=$?
  if printf '%s' "$out" | grep -q 'TypeError'; then
    bad "$tool crashed with a TypeError instead of refusing"
  elif ! printf '%s' "$out" | grep -q "7.0.2"; then
    bad "$tool did not name the unsupported version ($(printf '%s' "$out" | head -1))"
  elif ! printf '%s' "$out" | grep -qi 'does not speak'; then
    bad "$tool did not say the API is unsupported ($(printf '%s' "$out" | head -1))"
  elif [ "$rc" -eq 0 ]; then
    bad "$tool exited 0 on an unmeasurable project — a missing measurement must not read as a passing one"
  else
    ok "$tool refuses by version and exits $rc"
  fi
done

# 4. CONTROL — a SUPPORTED compiler must still load. The guard must not become a
#    blanket refusal, which would fail every project rather than the unmeasurable one.
if node -e "require('typescript')" 2>/dev/null; then
  out="$( node -e "
    import('file://$TS_DIR/ground-truth/load-typescript.mjs').then(async (m) => {
      const ts = m.loadTypeScript(process.cwd(), { toolName: 'control' });
      console.log('LOADED', typeof ts.createProgram, ts.version);
    }).catch((e) => { console.log('THREW', e.message); });
  " 2>&1 )"
  case "$out" in
    LOADED\ function*) ok "control: a supported compiler still loads (${out#LOADED function })" ;;
    *) bad "control: the guard rejected a SUPPORTED compiler ($out)" ;;
  esac
else
  ok "control: skipped, no typescript resolvable from here"
fi

# 5. CONTROL — the missing-API list is by PRESENCE, not by version number. A stub
#    reporting 5.9.9 but missing the API must still be refused, and one reporting a
#    high version WITH the API must not be.
mkdir -p "$W/oldstub/node_modules/typescript"
cat > "$W/oldstub/package.json" <<'EOF'
{ "name": "oldstub", "version": "1.0.0" }
EOF
cat > "$W/oldstub/node_modules/typescript/package.json" <<'EOF'
{ "name": "typescript", "version": "5.9.9", "main": "index.js" }
EOF
cat > "$W/oldstub/node_modules/typescript/index.js" <<'EOF'
module.exports = { version: '5.9.9', versionMajorMinor: '5.9' };
EOF
out="$( cd "$W/oldstub" && node "$TS_DIR/ground-truth/lib-files.mjs" "$W/oldstub" 2>&1 )"
if printf '%s' "$out" | grep -q '5.9.9'; then
  ok "control: refused by MISSING API, not by version number (a 5.x without the API is refused)"
else
  bad "control: a 5.x-looking compiler with no API was not refused ($(printf '%s' "$out" | head -1))"
fi

# 6. THE LINT. Every .mjs under test/typescript that reaches the compiler must come
#    through the shared loader, or this whole exercise moves to the next new tool.
# NEWLINE-delimited throughout: this repository is routinely checked out under a path
# containing a space, and splitting on $IFS turned one offender into two half-paths.
offenders="$W/offenders.txt"
: > "$offenders"
find "$TS_DIR" -name '*.mjs' -not -path '*/node_modules/*' -not -path '*/.work*' -print0 \
  | while IFS= read -r -d '' f; do
      case "$f" in */load-typescript.mjs) continue ;; esac
      # A file that already comes through the loader is not an offender however it
      # spells the rest.
      grep -q "load-typescript.mjs" "$f" && continue
      # TWO SHAPES, because matching only the literal specifier missed the one that
      # mattered. instrument.mjs reached the compiler as `createRequire(...)(TS_PATH)`
      # with TS_PATH a VARIABLE, so no 'typescript' literal appeared in a load
      # position and this lint stayed green while that tool ran on one machine only.
      # `createRequire` in an .mjs here exists to load the compiler; if a future one
      # needs it for something else, it can say so by importing the loader too.
      if grep -qE "^import .*from 'typescript'|require\('typescript'\)|createRequire" "$f"; then
        printf '%s\n' "${f#"$TS_DIR"/}" >> "$offenders"
      fi
    done
if [ -s "$offenders" ]; then
  bad "these load the compiler directly instead of via load-typescript.mjs:"
  sed 's/^/          /' "$offenders"
else
  ok "lint: every .mjs reaches the compiler through the shared loader"
fi

# 7. NO ABSOLUTE PATH INTO SOMEONE'S HOME. The lint above says WHERE the compiler
#    comes from; this says the answer may not be baked to one machine. It is the
#    defect class itself rather than one instance of it: a default like
#    `/Users/<name>/.../node_modules/typescript/lib/typescript.js` runs green for
#    whoever wrote it and is MODULE_NOT_FOUND for everyone else, and the tree is
#    public, so the path also publishes a developer's name and directory layout.
#    Environment variables and $HOME are the supported way to say "not in the repo".
homepaths="$W/homepaths.txt"
: > "$homepaths"
find "$TS_DIR" \( -name '*.mjs' -o -name '*.sh' -o -name '*.py' -o -name '*.ts' \) \
     -not -path '*/node_modules/*' -not -path '*/.work*' -print0 \
  | while IFS= read -r -d '' f; do
      if grep -qE '(^|[^A-Za-z0-9_$])/(Users|home)/[A-Za-z0-9._-]+/' "$f"; then
        printf '%s\n' "${f#"$TS_DIR"/}" >> "$homepaths"
      fi
    done
if [ -s "$homepaths" ]; then
  bad "these hard-code an absolute path under a home directory:"
  sed 's/^/          /' "$homepaths"
else
  ok "lint: no tool hard-codes a path under a home directory"
fi

if [ "$fail" -ne 0 ]; then
  echo "compiler-load: FAILED ($checks checks)"
  exit 1
fi
echo "compiler-load: ok ($checks checks)"
