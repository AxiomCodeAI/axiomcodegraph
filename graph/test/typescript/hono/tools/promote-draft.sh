#!/usr/bin/env bash
# Promote a REVIEWED oracle draft to the golden. Run only after reading the draft against the fixture:
# the header it writes is a claim that a person checked every row.
#   tools/promote-draft.sh <suite>/<case> "<one-line review note>"
set -euo pipefail
D="${HONO_SUITE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
id="$1"; note="$2"; suite="${id%%/*}"; name="${id#*/}"
census="$(grep -rhoE '(//|#) census: .*' "$D/cases/$id/src" | head -1 | sed -E 's@^(//|#) census: @@')"
[ -n "$census" ] || { echo "the fixture has no '// census:' header: cite the shape it models first" >&2; exit 1; }
for ext in tsv entries; do
  dr="$D/expected/$id.$ext.draft"; [ -f "$dr" ] || { echo "no draft $dr" >&2; exit 1; }
  { echo "# hand-reviewed $(date +%F) against the fixture and the oracle: $note"
    echo "# census: $census"
    cat "$dr"; } > "$D/expected/$id.$ext"
  rm -f "$dr"
done
