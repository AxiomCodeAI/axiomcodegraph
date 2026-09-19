#!/usr/bin/env python3
"""
Self-test for aggregate.py: THE VERDICT, not the numbers.

aggregate.py is the acceptance bar applied mechanically, and its whole reason for
existing is that a human reviewer reliably forgets to check whether a change fitted
the dev set. A bar that fires on the wrong shape is worse than none: it gets routed
around, and then it guards nothing.

EVERY CASE HERE IS A PAIR. The shape that must NOT fail is written beside the shape
that must, differing in one number, because a check that stops failing is
indistinguishable from a check that passes on everything. Three of the six cases
below exist only to fail.

The fixtures are synthetic score.json trees, which is what aggregate.py reads.

    ./aggregate-selftest.py [-v]

Exit status: 0 if every case passes, 1 otherwise. Needs python3 and nothing else.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
AGGREGATE = os.path.join(HERE, "aggregate.py")

DEV = ["alpha", "beta"]
HOLDOUT = ["gamma", "delta"]


def run_dir(root, name, projects):
    """One run: a directory of <project>/score.json, the shape run-corpus.sh writes."""
    d = os.path.join(root, name)
    os.makedirs(d, exist_ok=True)
    for proj, (pset, stats, fan, dropped) in projects.items():
        os.makedirs(os.path.join(d, proj), exist_ok=True)
        with open(os.path.join(d, proj, "score.json"), "w", encoding="utf-8") as fh:
            json.dump({"label": f"{proj}/{pset}", "stats": stats,
                       "fan": fan, "dropped": dropped}, fh)
    return d


def project(pset, held=1000, seen=900, in_source=500, agree=400, differs=10, none=90,
            ext=400, ext_lbl=200, wrong=0, fan_sites=100, fan_sound=90, dropped=0):
    return (pset, {
        "held_sites": held, "site_seen": seen, "in_source_sites": in_source,
        "declared_agree": agree, "declared_differs": differs, "declared_none": none,
        "external_sites": ext, "external_labelled": ext_lbl,
        "external_wrongly_resolved": wrong,
    }, {"sites": fan_sites, "sound": fan_sound, "exact": fan_sound}, dropped)


def verdict_of(root, before, after):
    proc = subprocess.run([sys.executable, AGGREGATE, before, after],
                          capture_output=True, text=True)
    for line in proc.stdout.splitlines():
        if line.strip().startswith("VERDICT"):
            return line.split("VERDICT", 1)[1].strip().split()[0], proc.stdout
    return "?", proc.stdout + proc.stderr


# ═════════════════════════════════════════════════════════════════════════════
# THE CASES
# ═════════════════════════════════════════════════════════════════════════════

def case_dilution_by_newly_visible_sites_is_not_overfitting(root):
    """
    A change that makes a CONSTRUCT VISIBLE FOR THE FIRST TIME enlarges the
    denominator. `in_source_sites` is exactly agree + differs + none, so it counts
    the in-source sites the engine SAW; sites it never saw were not in it.

    Here every previously scored site keeps its verdict and 100 new ones arrive, 80
    of them right. Agreeing rises 400 -> 480 and the rate falls 80.00% -> 80.00%...
    no: 400/500 is 80.00% and 480/600 is 80.00%, so the numbers below use 78% on the
    new ones to make the rate fall while the count rises, which is the real shape.

    It must not be reported as "the rule fits the dev set": the held-out set gained
    78 correct answers it did not have.
    """
    before = run_dir(root, "b1", {
        "alpha": project("dev", in_source=500, agree=400, differs=10, none=90),
        "beta": project("dev", in_source=500, agree=400, differs=10, none=90),
        "gamma": project("holdout", in_source=500, agree=440, differs=10, none=50),
        "delta": project("holdout", in_source=500, agree=440, differs=10, none=50),
    })
    after = run_dir(root, "a1", {
        # dev improves a little on the same population
        "alpha": project("dev", in_source=500, agree=402, differs=10, none=88),
        "beta": project("dev", in_source=500, agree=402, differs=10, none=88),
        # holdout gains 100 newly visible sites each, 78 of them correct
        "gamma": project("holdout", in_source=600, agree=518, differs=10, none=72),
        "delta": project("holdout", in_source=600, agree=518, differs=10, none=72),
    })
    v, out = verdict_of(root, before, after)
    yield "not reported as fitting the dev set", v != "FAIL", (v, out)
    yield "reported as a WARN to be read", v == "WARN", (v, out)
    yield "and the counts are named", "grew by 200" in out, out


def case_a_real_regression_on_a_fixed_population_still_fails(root):
    """
    CONTROL for the case above, and the one that matters. The SAME rate movements --
    dev up, holdout down -- with the population UNCHANGED. Nothing new became
    visible; held-out sites that used to agree stopped agreeing. That is exactly
    what fitting the dev set looks like and it must still be FAIL.
    """
    before = run_dir(root, "b2", {
        "alpha": project("dev", in_source=500, agree=400, differs=10, none=90),
        "beta": project("dev", in_source=500, agree=400, differs=10, none=90),
        "gamma": project("holdout", in_source=500, agree=440, differs=10, none=50),
        "delta": project("holdout", in_source=500, agree=440, differs=10, none=50),
    })
    after = run_dir(root, "a2", {
        "alpha": project("dev", in_source=500, agree=410, differs=10, none=80),
        "beta": project("dev", in_source=500, agree=410, differs=10, none=80),
        "gamma": project("holdout", in_source=500, agree=430, differs=20, none=50),
        "delta": project("holdout", in_source=500, agree=430, differs=20, none=50),
    })
    v, out = verdict_of(root, before, after)
    yield "still fails", v == "FAIL", (v, out)
    yield "with the dev-set-fitting reason", "fits the dev set" in out, out


def case_a_population_that_grew_while_agreement_fell_fails(root):
    """
    CONTROL. The denominator grew AND the agreeing count fell. That is the worst
    case, not the best one: new sites arrived and old ones broke. A rule keyed on
    "the population changed" alone would wave it through.
    """
    before = run_dir(root, "b3", {
        "alpha": project("dev", in_source=500, agree=400, differs=10, none=90),
        "beta": project("dev", in_source=500, agree=400, differs=10, none=90),
        "gamma": project("holdout", in_source=500, agree=440, differs=10, none=50),
        "delta": project("holdout", in_source=500, agree=440, differs=10, none=50),
    })
    after = run_dir(root, "a3", {
        "alpha": project("dev", in_source=500, agree=410, differs=10, none=80),
        "beta": project("dev", in_source=500, agree=410, differs=10, none=80),
        "gamma": project("holdout", in_source=600, agree=430, differs=20, none=150),
        "delta": project("holdout", in_source=600, agree=430, differs=20, none=150),
    })
    v, out = verdict_of(root, before, after)
    yield "fails", v == "FAIL", (v, out)
    yield "with the dev-set-fitting reason", "fits the dev set" in out, out


def case_new_sites_that_are_mostly_wrong_fail(root):
    """
    CONTROL. The population grew and the agreeing count rose, but DISAGREEING rose
    further: the newly visible sites are mostly wrong. Adding a construct the engine
    cannot answer is not a win to be waved through as dilution.
    """
    before = run_dir(root, "b4", {
        "alpha": project("dev", in_source=500, agree=400, differs=10, none=90),
        "beta": project("dev", in_source=500, agree=400, differs=10, none=90),
        "gamma": project("holdout", in_source=500, agree=440, differs=10, none=50),
        "delta": project("holdout", in_source=500, agree=440, differs=10, none=50),
    })
    after = run_dir(root, "a4", {
        "alpha": project("dev", in_source=500, agree=410, differs=10, none=80),
        "beta": project("dev", in_source=500, agree=410, differs=10, none=80),
        "gamma": project("holdout", in_source=700, agree=450, differs=10, none=240),
        "delta": project("holdout", in_source=700, agree=450, differs=10, none=240),
    })
    v, out = verdict_of(root, before, after)
    yield "fails", v == "FAIL", (v, out)


def case_a_dropped_site_fails_whatever_the_rates_do(root):
    """
    CONTROL for the whole mechanism. A dropped site is a defect, not imprecision, and
    no argument about populations touches it.
    """
    before = run_dir(root, "b5", {
        "alpha": project("dev"), "beta": project("dev"),
        "gamma": project("holdout"), "delta": project("holdout"),
    })
    after = run_dir(root, "a5", {
        "alpha": project("dev", agree=450, none=40), "beta": project("dev"),
        "gamma": project("holdout", dropped=1), "delta": project("holdout"),
    })
    v, out = verdict_of(root, before, after)
    yield "fails", v == "FAIL", (v, out)
    yield "naming the dropped site", "dropped sites rose" in out, out


def case_a_fan_that_lost_a_target_fails(root):
    """
    CONTROL. A narrower fan reads as a precision win in a summary and is an
    unsoundness: the reverse closure from the lost target finds no caller.
    """
    before = run_dir(root, "b6", {
        "alpha": project("dev"), "beta": project("dev"),
        "gamma": project("holdout", fan_sites=100, fan_sound=90),
        "delta": project("holdout", fan_sites=100, fan_sound=90),
    })
    after = run_dir(root, "a6", {
        "alpha": project("dev"), "beta": project("dev"),
        "gamma": project("holdout", fan_sites=100, fan_sound=85),
        "delta": project("holdout", fan_sites=100, fan_sound=90),
    })
    v, out = verdict_of(root, before, after)
    yield "fails", v == "FAIL", (v, out)
    yield "naming the lost targets", "the fan lost" in out, out


CASES = [
    case_dilution_by_newly_visible_sites_is_not_overfitting,
    case_a_real_regression_on_a_fixed_population_still_fails,
    case_a_population_that_grew_while_agreement_fell_fails,
    case_new_sites_that_are_mostly_wrong_fail,
    case_a_dropped_site_fails_whatever_the_rates_do,
    case_a_fan_that_lost_a_target_fails,
]


def main():
    verbose = "-v" in sys.argv
    passed = failed = 0
    for case in CASES:
        with tempfile.TemporaryDirectory(prefix="cs-aggregate-selftest-") as tmp:
            title = case.__name__.replace("case_", "").replace("_", " ")
            checks, gen = [], case(tmp)
            while True:
                try:
                    checks.append(next(gen))
                except StopIteration:
                    break
                except Exception as ex:
                    checks.append((f"raised {type(ex).__name__}: {ex}", False, "-"))
                    break
            bad = [(what, got) for what, ok, got in checks if not ok]
            if bad:
                failed += 1
                print(f"  ✗ {title}")
                for what, got in bad:
                    print(f"      {what}\n        got {got}")
            else:
                passed += 1
                print(f"  ✓ {title}" + (f"  ({len(checks)} checks)" if verbose else ""))

    print(f"\naggregate.py self-test: {passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
