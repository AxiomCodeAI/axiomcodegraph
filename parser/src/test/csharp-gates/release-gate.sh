#!/usr/bin/env bash
# RELEASE GATE for the C# front end — runs before any merge into `c-sharp`.
#
# The shipping suite (`csharp-tests.ts`) and the scrub gate are fast and
# hermetic and run on every change. The negative-control harness and the
# derived-column sweep are DEV-ONLY: they take tens of minutes, mutate the
# source tree in place and restore it, and prove that the shipping gates are
# CAPABLE OF FAILING. A dev-only proof that never runs on a schedule rots, and
# then the claim that the shipped gates can fail is itself stale — so this
# script is the trigger. It runs all four, refuses on any red, and prints the
# one line that goes into the merge commit message:
#
#   release-gate commit <sha> tree <tree> <date>: shipping N/N checks passed, scrub 0 hits, sweep covered=n uncovered=0 inert=0, controls OK=n BAD=0 of n
#
# A merge into `c-sharp` without that line in its message has not run this.
#
# THE LINE IS A CLAIM ABOUT A COMMIT, NEVER ABOUT A BRANCH. "The gate ran on
# 406418e" was true while the branch had already advanced two commits to a
# different tree — a true statement read one level up. So the line names the
# commit AND its tree, and a report that quotes it says "commit", not
# "c-sharp": the branch may have moved the moment the line was printed.
#
# Preconditions: a CLEAN working tree at the commit being merged (the harness
# and the sweep mutate files and restore them by byte copy; anything unstaged
# is at risk), no other harness running (the lock file refuses), and no git
# tree operation — checkout, stash, rebase — for the whole run.
set -u
cd "$(dirname "$0")/../../.."

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "release-gate: the working tree is not clean; commit or discard first." >&2
  exit 3
fi
sha="$(git rev-parse --short HEAD)"
# The TREE as well as the commit: a merge is gated on its merged tree before
# the merge commit exists (the commit's message must carry this line, and a
# branch others may have is never amended), so the line names the tree the
# gate ran over and `git rev-parse <merge>^{tree}` verifies it afterwards.
tree="$(git rev-parse --short HEAD^{tree})"
date="$(date +%Y-%m-%d)"
started="$(date +%H:%M:%S)"

shipping="$(npx tsx src/test/csharp-tests.ts 2>&1 | grep -E '^[0-9]+/[0-9]+ checks passed' | tail -1)"
case "$shipping" in
  "") echo "release-gate: the shipping suite did not report a tally" >&2; exit 1 ;;
esac
s_pass="${shipping%%/*}"; s_total="$(echo "$shipping" | sed -E 's#^[0-9]+/([0-9]+) .*#\1#')"
if [ "$s_pass" != "$s_total" ]; then echo "release-gate: shipping suite $shipping" >&2; exit 1; fi

# THE SCRUB GATE HAS THREE OUTPUT FORMS AND THIS PARSED ONE.
#
#   "SCRUB GATE: clean — N files scanned, 0 hits"   the PASSING form
#   "SCRUB GATE: N hit(s) in M file(s), K scanned"  the failing form
#   "SCRUB GATE: scanned zero files …"              the refusing form
#
# The sed matched only the second. On the passing form it matched nothing and
# left the whole line in place, which is not "0", so the gate exited 1 — a
# release gate that could not pass a clean scrub. It is the mirror of the error
# this repo cares most about: a check that cannot fail is worthless, and a gate
# that cannot pass is worse than worthless because it trains people to skip it.
#
# Matched EXPLICITLY, with an unrecognised form REFUSED rather than assumed
# clean: the next form added must be handled here rather than default to pass.
scrub="$(npx tsx src/test/oss/scrub-gate.ts 2>&1 | grep -E '^SCRUB GATE:' | tail -1)"
case "$scrub" in
  "SCRUB GATE: clean"*)   : ;;
  "SCRUB GATE: scanned zero files"*) echo "release-gate: $scrub" >&2; exit 1 ;;
  *" hit(s) "*)           echo "release-gate: $scrub" >&2; exit 1 ;;
  *) echo "release-gate: the scrub gate said something this script does not recognise: ${scrub:-<nothing>}" >&2; exit 1 ;;
esac

sweep_out="$(bash src/test/csharp-gates/derived-column-sweep.sh 2>&1)"
sweep="$(echo "$sweep_out" | grep -E '^covered [0-9]+ +UNCOVERED [0-9]+ +inert [0-9]+' | tail -1)"
sweep_ok="$(echo "$sweep" | sed -E 's/^covered ([0-9]+).*/\1/')"
sweep_bad="$(echo "$sweep" | sed -E 's/.*UNCOVERED ([0-9]+) +inert ([0-9]+).*/\1+\2/' | bc)"
if [ -z "$sweep" ] || [ "$sweep_bad" != "0" ]; then echo "release-gate: derived-column sweep: ${sweep:-no tally}" >&2; echo "$sweep_out" | grep -E '^(UNCOVERED|INERT)' >&2; exit 1; fi

controls_out="$(bash src/test/csharp-gates/negative-controls.sh 2>&1)"
controls="$(echo "$controls_out" | grep -E '^negative-controls: OK=[0-9]+ BAD=[0-9]+ MISCLASSIFIED=[0-9]+ INCONCLUSIVE=[0-9]+ of [0-9]+ controls' | tail -1)"
c_ok="$(echo "$controls" | sed -E 's/.*OK=([0-9]+).*/\1/')"
c_bad="$(echo "$controls" | sed -E 's/.*BAD=([0-9]+).*/\1/')"
c_inc="$(echo "$controls" | sed -E 's/.*INCONCLUSIVE=([0-9]+).*/\1/')"
c_mis="$(echo "$controls" | sed -E 's/.*MISCLASSIFIED=([0-9]+).*/\1/')"
c_of="$(echo "$controls" | sed -E 's/.*of ([0-9]+) controls.*/\1/')"
c_runs="$(echo "$controls" | sed -E 's/.*\(runs=([0-9]+);.*/\1/')"
# A tally assembled from more than one run is a claim about more than one
# machine state. The strict gate wants one run; `--allow-resumed` accepts an
# assembled tally and the merge message must quote its runs= count.
if [ "$c_runs" != "1" ] && [ "${1:-}" != "--allow-resumed" ]; then echo "release-gate: negative controls: the tally was assembled from $c_runs runs; pass --allow-resumed to accept it, and quote runs=$c_runs in the merge message" >&2; exit 1; fi
# OK must equal the control count: a BAD or an INCONCLUSIVE control is not a
# demonstration, and a tally short of the count means one never reported.
if [ -z "$controls" ] || [ "$c_bad" != "0" ] || [ "$c_inc" != "0" ] || [ "$c_mis" != "0" ] || [ "$c_ok" != "$c_of" ]; then echo "release-gate: negative controls: ${controls:-no tally}" >&2; echo "$controls_out" | grep -E '^(BAD|MIS|\?\?)' >&2; exit 1; fi

# The suite must be green AFTER the mutating runs too, or a restore failed.
after="$(npx tsx src/test/csharp-tests.ts 2>&1 | grep -E '^[0-9]+/[0-9]+ checks passed' | tail -1)"
if [ "$after" != "$shipping" ]; then echo "release-gate: the suite is $after after the harness restored the tree; it was $shipping before" >&2; exit 1; fi

echo "release-gate commit $sha tree $tree $date: shipping $shipping, scrub 0 hits, sweep covered=$sweep_ok uncovered=0 inert=0, controls OK=$c_ok BAD=0 MISCLASSIFIED=0 INCONCLUSIVE=0 of $c_of runs=$c_runs (started $started, finished $(date +%H:%M:%S))"
