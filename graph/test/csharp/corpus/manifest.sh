#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Resolve the corpus manifest, which is DELIBERATELY NOT IN THIS REPOSITORY.
#
# The manifest names the projects the engine is measured against and which of the
# two sets each one is in. That is the evaluation set, and publishing it invites
# exactly the thing the held-out half exists to prevent: a rule tuned, however
# unconsciously, to the projects it will be scored on. The split has to be pinned
# to be reproducible, so it is pinned -- in a file the operator holds, not in the
# tree.
#
# corpus.tsv.template documents the format and carries no entries. Copy it, fill it
# in, and point CS_CORPUS_MANIFEST at it, or leave it at the default path.
#
# Sourced, not executed: it sets CORPUS_MANIFEST for the caller.
# ─────────────────────────────────────────────────────────────────────────────
resolve_corpus_manifest() {
  local here="$1"
  CORPUS_MANIFEST="${CS_CORPUS_MANIFEST:-$HOME/.config/axiom/cs-corpus.tsv}"
  if [ ! -f "$CORPUS_MANIFEST" ]; then
    echo "no corpus manifest at $CORPUS_MANIFEST" >&2
    echo "" >&2
    echo "The corpus is not defined in this repository. Copy the template and fill it in:" >&2
    echo "  mkdir -p \"\$(dirname \"$CORPUS_MANIFEST\")\"" >&2
    echo "  cp $here/corpus.tsv.template \"$CORPUS_MANIFEST\"" >&2
    echo "" >&2
    echo "Or set CS_CORPUS_MANIFEST to one you already have." >&2
    return 1
  fi
  export CORPUS_MANIFEST
}
