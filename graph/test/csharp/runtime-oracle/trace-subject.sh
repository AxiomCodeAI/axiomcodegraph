#!/bin/bash
# =============================================================================
# Trace one corpus project: mirror it, instrument the mirror, run ITS OWN test
# suite, and keep what ran.
#
# THE MIRROR IS THE POINT. Instrumenting in place would leave the corpus checkout
# rewritten, and every later engine run would analyse the tracer's own probes.
#
# THE SUITE IS THE DRIVER, not a workload written for this measurement. A trace
# from a workload someone wrote while looking at the engine's output measures the
# author, not the program. It also means the coverage is whatever the project's
# own tests cover, which is a property of the subject and is reported rather than
# worked around.
#
# WHAT A TRACE IS AND IS NOT. It is a LOWER BOUND on behaviour: everything in it
# happened. It is not an upper bound -- a path the suite does not exercise is
# absent, and absence is not evidence. The join enforces that distinction and the
# engine rules that read a trace only ever ADD, never subtract.
#
# Usage: trace-subject.sh <name> <work-dir>
#   <name> is a corpus.tsv entry. The TEST project is discovered from the
#   repository rather than configured, because a per-project test command is one
#   more thing that silently goes stale.
# =============================================================================
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TESTDIR="$(cd "$HERE/.." && pwd)"
CORPUS="${CS_CORPUS:-$HOME/.cache/axiom-cs-corpus}"
INSTRUMENT="$HERE/AxiomCsInstrument/bin/Release/net8.0/axiom-cs-instrument"

NAME="${1:-}"; WORK="${2:-}"
[ -n "$NAME" ] && [ -n "$WORK" ] || { echo "usage: trace-subject.sh <name> <work-dir>" >&2; exit 2; }
mkdir -p "$WORK"; WORK="$(cd "$WORK" && pwd)"

command -v dotnet >/dev/null || { echo "dotnet is not on PATH" >&2; exit 77; }
[ -x "$INSTRUMENT" ] || {
  echo "the instrumenter is not built. Run:" >&2
  echo "  dotnet build -c Release $HERE/AxiomCsInstrument" >&2
  exit 77; }

# The corpus entry: its path is the library subtree, and the REPOSITORY root is
# what has to be mirrored, because the test project lives outside it.
LINE="$(awk -F'\t' -v n="$NAME" '$1==n {print; exit}' "$TESTDIR/corpus/corpus.tsv")"
[ -n "$LINE" ] || { echo "$NAME is not in corpus.tsv" >&2; exit 2; }
SUBPATH="$(printf '%s' "$LINE" | cut -f3)"
REPO_SRC="$CORPUS/$NAME"
[ -d "$REPO_SRC/.git" ] || { echo "$NAME is not provisioned; run corpus/fetch.sh" >&2; exit 77; }

MIRROR="$WORK/mirror"; TRACE="$WORK/trace"
rm -rf "$MIRROR" "$TRACE"; mkdir -p "$MIRROR" "$TRACE"

echo "▶ $NAME: mirroring"
# -a keeps mtimes so the build's own up-to-date checks stay meaningful. obj/ and
# bin/ are excluded so the mirror builds from source rather than reusing artefacts
# compiled from the UNINSTRUMENTED tree, which is how a trace comes back empty
# after a green build.
rsync -a --exclude .git --exclude obj --exclude bin --exclude .vs \
      "$REPO_SRC"/ "$MIRROR"/ 2>/dev/null || {
  echo "  rsync unavailable; falling back to cp"; cp -R "$REPO_SRC"/. "$MIRROR"/; }

echo "▶ $NAME: instrumenting $SUBPATH"
# ONLY THE LIBRARY SUBTREE is instrumented. Probing the test project as well would
# fill the trace with edges between test helpers, and the engine is not run over
# the tests either -- so the two sides would be measuring different programs.
cp "$HERE/AxiomCsTrace.cs" "$MIRROR/$SUBPATH/AxiomCsTrace.cs"
"$INSTRUMENT" --src "$MIRROR" --ids "$WORK/ids.tsv" --only "$SUBPATH" || exit 1

# ── the test project ────────────────────────────────────────────────────────
# Discovered, not configured: a per-project test command is one more thing that goes
# stale silently. But discovery has to be more than "the first csproj that mentions
# xunit", which picked `Serilog.ApprovalTests`, `Snippets` and
# `Humanizer.SourceGenerators.Tests` -- none of them the suite that exercises the
# library.
#
# Two filters, in this order:
#   1. IT MUST BUILD ON THE INSTALLED SDK. `-f net8.0` alone is not enough on a
#      multi-targeted project -- it still built the net9.0 leg -- so TargetFrameworks
#      is overridden to the one framework as well. Several of these repositories' test
#      projects target net10.0 only, and the static oracle is pinned to the 8.0 SDK
#      so a parser figure and an engine figure stay comparable. A project whose TFM
#      list has nothing the SDK supports is reported, not attempted -- otherwise the
#      run ends in a build error that looks like a tracer failure.
#   2. PREFER A NAME THAT SAYS Tests, and prefer the shortest such name, which is the
#      main suite rather than a satellite (`Foo.Tests` over
#      `Foo.SourceGenerators.Tests`).
# ── global.json ─────────────────────────────────────────────────────────────
# Several of these repositories pin an SDK version in global.json, and the pin is
# newer than the one this harness uses. The pin is a developer convenience rather
# than a property of the program: the library and its tests both list net8.0 among
# their TargetFrameworks, so building them with the 8.0 SDK is a configuration the
# project itself supports.
#
# So the pin is RELAXED IN THE MIRROR and the deviation is RECORDED. It is a real
# deviation -- a newer SDK could compile the same source differently -- and it
# belongs in the manifest rather than in a comment nobody reads next to a number.
GLOBALJSON_RELAXED="no"
if [ -f "$MIRROR/global.json" ]; then
  mv "$MIRROR/global.json" "$MIRROR/global.json.axiom-disabled"
  GLOBALJSON_RELAXED="yes ($(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$MIRROR/global.json.axiom-disabled" | head -1))"
  echo "▶ $NAME: global.json pin relaxed -- $GLOBALJSON_RELAXED"
fi

echo "▶ $NAME: looking for a test project"
SDK_TFM="net8.0"
CANDIDATES=""
while IFS= read -r proj; do
  grep -qE 'Microsoft\.NET\.Test\.Sdk|xunit|NUnit|MSTest' "$proj" 2>/dev/null || continue
  grep -qE "<TargetFrameworks?>[^<]*${SDK_TFM}" "$proj" 2>/dev/null || {
    echo "  skip $(basename "$proj"): no $SDK_TFM in its TargetFrameworks"; continue; }
  CANDIDATES="$CANDIDATES$proj"$'\n'
done < <(find "$MIRROR" -name '*.csproj' -not -path '*/obj/*' | sort)

TESTPROJ="$(printf '%s' "$CANDIDATES" | grep -iE '[./]?[^/]*Tests?\.csproj$' \
            | awk '{ print length($0), $0 }' | sort -n | head -1 | cut -d' ' -f2-)"
[ -n "$TESTPROJ" ] || TESTPROJ="$(printf '%s' "$CANDIDATES" | head -1)"

if [ -z "$TESTPROJ" ]; then
  echo "  no test project this SDK can build; nothing to trace"
  printf 'skipped\tno_buildable_test_project\n' > "$WORK/trace.manifest.tsv"
  exit 77
fi
echo "  $TESTPROJ"

echo "▶ $NAME: running the suite under the tracer"
set +e
(
  cd "$MIRROR"
  AXIOM_CS_TRACE_OUT="$TRACE" \
  DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 \
  dotnet test "$TESTPROJ" \
    --nologo -v q \
    -f "$SDK_TFM" \
    -p:TargetFrameworks="$SDK_TFM" \
    -p:TargetFramework="$SDK_TFM" \
    -p:TreatWarningsAsErrors=false \
    -p:WarningsAsErrors= \
    -p:NoWarn=CS0618%3BCS0612%3BCS8618%3BCS1591 \
    -p:GenerateDocumentationFile=false \
    -p:EnableNETAnalyzers=false
) > "$WORK/test-output.txt" 2>&1
STATUS=$?
set -e
tail -6 "$WORK/test-output.txt"

N=$(ls "$TRACE" 2>/dev/null | wc -l | tr -d ' ')
echo "▶ $NAME: suite exit $STATUS, $N trace file(s)"
# A FAILING SUITE IS NOT A FAILED TRACE. A test that throws still executed the code
# that led to the throw, and those edges are real. The status is recorded and the
# trace is kept; what would make it unusable is no trace at all.
printf 'suiteExit\t%s\ntraceFiles\t%s\ntestProject\t%s\nglobalJsonRelaxed\t%s\nsdk\t%s\n' \
  "$STATUS" "$N" "${TESTPROJ#$MIRROR/}" "$GLOBALJSON_RELAXED" \
  "$(dotnet --version 2>/dev/null || echo '?')" > "$WORK/trace.manifest.tsv"
[ "$N" -gt 0 ] || { echo "  !! no trace produced"; exit 1; }
exit 0
