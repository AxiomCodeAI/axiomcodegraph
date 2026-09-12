#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Apply the branch ruleset that makes `main` unpushable.
#
# WHY THIS IS A SCRIPT AND NOT ALREADY APPLIED
# Rulesets and protected branches are refused with HTTP 403 on a PRIVATE
# repository owned by a FREE organisation. AxiomCodeAI is on Free, so the rule
# below cannot exist yet. It becomes available the moment either is true:
#
#   * this repository is made public  — rulesets are free on public repos, or
#   * the organisation moves to Team  — ~$4 per seat per month.
#
# Run this script on that day. It is idempotent: it updates the existing ruleset
# if one is already there, and creates it otherwise.
#
#   bash .github/scripts/protect-main.sh            # apply
#   bash .github/scripts/protect-main.sh --dry-run  # print the payload only
#
# WHAT IT ENFORCES
#   - no direct push to main, and no force-push, by anyone including admins
#   - main cannot be deleted
#   - every change arrives by pull request, with 1 approving review
#   - a review is dismissed when new commits are pushed
#   - CODEOWNERS review required
#   - the `CI` check must pass, against the merge commit, not a stale run
#   - linear history — squash or rebase, no merge bubbles
#
# `bypass_actors` is deliberately EMPTY. A ruleset an admin can walk around is a
# convention, not a control, and the admin is the only account here that can push
# to main in the first place.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="${REPO:-AxiomCodeAI/axiom-code-graph}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

payload="$(cat <<'JSON'
{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] }
  },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["squash", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "CI" }
        ]
      }
    }
  ]
}
JSON
)"

if [ "$DRY" = "1" ]; then
  echo "$payload"
  exit 0
fi

# Refuse early with a readable reason rather than a raw 403.
if ! gh api "repos/$REPO/rulesets" >/dev/null 2>&1; then
  cat >&2 <<'MSG'
Rulesets are not available on this repository yet.

  A private repository in a Free organisation cannot have protected branches.
  Make the repository public, or move AxiomCodeAI to the Team plan, then run
  this script again. Nothing else about it needs to change.
MSG
  exit 1
fi

existing="$(gh api "repos/$REPO/rulesets" --jq '.[] | select(.name=="protect-main") | .id' || true)"

if [ -n "$existing" ]; then
  echo "updating ruleset $existing on $REPO"
  printf '%s' "$payload" | gh api -X PUT "repos/$REPO/rulesets/$existing" --input - >/dev/null
else
  echo "creating ruleset on $REPO"
  printf '%s' "$payload" | gh api -X POST "repos/$REPO/rulesets" --input - >/dev/null
fi

# Merge-method hygiene lives on the repository, not the ruleset: squash-only, and
# delete the branch once it has landed so the branch list stops accumulating the
# stale aliases this repo has collected before.
gh api -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -F allow_auto_merge=true >/dev/null

echo "done. main now requires a pull request and a green CI check."
gh api "repos/$REPO/rulesets" --jq '.[] | "  ruleset: \(.name)  enforcement=\(.enforcement)"'
