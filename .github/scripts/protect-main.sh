#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Apply the branch ruleset for `main`.
#
#   bash .github/scripts/protect-main.sh            # apply
#   bash .github/scripts/protect-main.sh --dry-run  # print the payload only
#
# Idempotent: updates the ruleset if it exists, creates it otherwise.
#
# What it enforces
#   - no direct push to main, and no force-push
#   - main cannot be deleted
#   - every change arrives by pull request; no approving review is required
#   - the `CI` check must pass, evaluated against an up-to-date branch
#   - only the repository ADMIN role may merge into main (ruleset main-merge-admins):
#     anyone can open a pull request, an admin merges it, their own included
#   - linear history: squash or rebase, no merge bubbles
#   - a release tag (v*) can be created but never moved or deleted: npm will not
#     republish a version, so a tag that moved would name a tree nobody installed
#
# protect-main has no bypass: the PR and CI rules hold for admins too. The merge
# restriction is a separate ruleset so that its bypass (admins, and only through a
# pull request) exempts nobody from those.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="${REPO:-AxiomCodeAI/axiomcodegraph}"
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
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
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

merge_payload="$(cat <<'JSON'
{
  "name": "main-merge-admins",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] }
  },
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request" }
  ],
  "rules": [
    { "type": "update" }
  ]
}
JSON
)"

tag_payload="$(cat <<'JSON'
{
  "name": "protect-release-tags",
  "target": "tag",
  "enforcement": "active",
  "conditions": {
    "ref_name": { "include": ["refs/tags/v*"], "exclude": [] }
  },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "update" },
    { "type": "non_fast_forward" }
  ]
}
JSON
)"

if [ "$DRY" = "1" ]; then
  echo "$payload"
  echo "$merge_payload"
  echo "$tag_payload"
  exit 0
fi

# Fail with something readable rather than a raw API error.
if ! gh api "repos/$REPO/rulesets" >/dev/null 2>&1; then
  echo "cannot read rulesets on $REPO — check that this account has admin rights there" >&2
  exit 1
fi

apply_ruleset() {
  local name="$1" body="$2" existing
  existing="$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name==\"$name\") | .id" || true)"
  if [ -n "$existing" ]; then
    echo "updating ruleset $name ($existing) on $REPO"
    printf '%s' "$body" | gh api -X PUT "repos/$REPO/rulesets/$existing" --input - >/dev/null
  else
    echo "creating ruleset $name on $REPO"
    printf '%s' "$body" | gh api -X POST "repos/$REPO/rulesets" --input - >/dev/null
  fi
}
apply_ruleset protect-main "$payload"
apply_ruleset main-merge-admins "$merge_payload"
apply_ruleset protect-release-tags "$tag_payload"

# Merge-method hygiene lives on the repository, not the ruleset: squash-only, and
# delete the branch once it has landed so the branch list stops accumulating the
# stale aliases this repo has collected before.
gh api -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -F allow_auto_merge=true >/dev/null

echo "done. main requires a pull request and a green CI check; only admins merge."
gh api "repos/$REPO/rulesets" --jq '.[] | "  ruleset: \(.name)  enforcement=\(.enforcement)"'
