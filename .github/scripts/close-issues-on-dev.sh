#!/usr/bin/env bash
# close-issues-on-dev.sh — close the issues named by pull requests that merged into a branch other than
# dev, once their merge commit is part of dev (see .github/workflows/close-issues-on-dev.yml).
#
#   DRY_RUN=1 .github/scripts/close-issues-on-dev.sh     # list, close nothing
#
# Needs: gh (authenticated; GH_TOKEN in CI), a checkout with full history, and origin/dev or HEAD on dev.
# LOOKBACK: how many recently merged pull requests to consider (default 300).
set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"
LOOKBACK="${LOOKBACK:-300}"
REPO="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
DEV_REF="${DEV_REF:-HEAD}"
[ "$DEV_REF" = HEAD ] && [ "$(git rev-parse --abbrev-ref HEAD)" != dev ] && DEV_REF=origin/dev

closed=0; pending=0
while IFS=$'\t' read -r pr base merge body64; do
  [ -n "$merge" ] || continue
  [ "$base" = dev ] && continue                               # GitHub closes these itself
  if ! git merge-base --is-ancestor "$merge" "$DEV_REF" 2>/dev/null; then
    pending=$((pending + 1)); continue                        # merged, but not on dev yet
  fi
  body=$(printf '%s' "$body64" | base64 --decode)
  for n in $(printf '%s\n' "$body" | grep -oiE '\b(close[sd]?|fix(e[sd])?|resolve[sd]?)[[:space:]]*:?[[:space:]]+#[0-9]+' \
             | grep -oE '[0-9]+$' | sort -un); do
    state=$(gh issue view "$n" --repo "$REPO" --json state -q .state 2>/dev/null || echo MISSING)
    [ "$state" = OPEN ] || continue
    if [ "$DRY_RUN" = 1 ]; then
      echo "would close #$n  (pull request #$pr into $base, ${merge:0:9} is on dev)"
    else
      gh issue close "$n" --repo "$REPO" \
        --comment "Closed by #$pr, which merged into \`$base\` and reached \`dev\` in ${merge:0:9}."
      echo "closed #$n  (pull request #$pr into $base)"
    fi
    closed=$((closed + 1))
  done
done < <(gh pr list --repo "$REPO" --state merged --limit "$LOOKBACK" \
           --json number,baseRefName,mergeCommit,body \
           -q '.[] | [.number, .baseRefName, (.mergeCommit.oid // ""), (.body // "" | @base64)] | @tsv')

verb=closed; [ "$DRY_RUN" = 1 ] && verb="to close"
echo "issues $verb: $closed; merged pull requests not on dev yet: $pending"
