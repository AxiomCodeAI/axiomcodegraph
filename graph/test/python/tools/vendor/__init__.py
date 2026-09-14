"""VENDORED from the callchain-oracle harness — do not edit here.

WHY THIS EXISTS. test/python's engine-side tools (engine_edges.py, coverage_guard.py)
normalize a call site's identity — module qualname, anchor line, comprehension scope —
and they MUST agree with the CPython ground truth about what "the same call site" means,
or a real disagreement reads as a naming mismatch. The harness solves that by having the
engine side IMPORT its normalizer rather than reimplement it.

That import made the whole Python suite unrunnable without a checkout of
AxiomCode/callchain-oracle sitting outside this repo: not just `--oracle`, but the plain
golden diff too. For a repo that has to be cloneable on its own, that is not acceptable.

So the two modules the ENGINE side needs are vendored here, and are the copy the suite
always uses — which makes the goldens reproducible in a bare clone. The anti-drift
property is preserved where it can be: tools/check_vendor.py fails if a harness IS
present and has diverged from these copies, so the two cannot silently disagree on any
machine that has both. The oracle path itself (--oracle) still imports the real harness.

Sync: copy callchain_oracle/{normalize,tier1_sites}.py here and re-run check_vendor.py.
"""
