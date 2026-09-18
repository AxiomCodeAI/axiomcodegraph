#!/usr/bin/env python3
"""
Aggregate the per-project scores from a corpus run, and diff two runs.

  aggregate.py <work-dir>                       one run, two tables
  aggregate.py <before-dir> <after-dir>         the diff, with a verdict

THE TWO SETS ARE NEVER SUMMED. A combined number cannot answer the one question
that matters about a rule change: did it generalise, or did it fit the projects it
was written against. So dev and holdout get separate tables and the diff reports
them side by side.

THE VERDICT IS THE ACCEPTANCE BAR, APPLIED MECHANICALLY rather than read off a
table by eye:

  FAIL  a site was dropped, or an external target was wrongly resolved. Both are
        defects rather than imprecision: a dropped site is invisible downstream,
        and a wrongly resolved external target is an edge the compiler does not
        make.
  FAIL  the dispatch fan lost a target it had before. A narrower fan looks like a
        precision win in a summary and is an unsoundness.
  FAIL  dev improved and holdout got worse. That is the definition of fitting the
        dev set, and it is the check a human reviewer reliably forgets.
  WARN  dev improved and holdout did not move. Not a failure -- a construct may
        genuinely not occur in the held-out set -- but it is not evidence of
        generalisation either, and it must not be reported as though it were.
  PASS  both sets moved the same way, and nothing regressed.
"""
import json
import os
import sys

FIELDS = [
    ("held_sites", "sites"),
    ("site_seen", "seen"),
    ("in_source_sites", "in-src"),
    ("declared_agree", "agree"),
    ("declared_differs", "differ"),
    ("declared_none", "none"),
    ("external_sites", "ext"),
    ("external_labelled", "ext-lbl"),
    ("external_wrongly_resolved", "ext-WRONG"),
]


def load(work):
    out = {}
    if not os.path.isdir(work):
        sys.exit(f"aggregate: no such directory {work}")
    for name in sorted(os.listdir(work)):
        p = os.path.join(work, name, "score.json")
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as fh:
            d = json.load(fh)
        label = d.get("label", name)
        pset = label.split("/")[-1] if "/" in label else "?"
        out[name] = {"set": pset, "stats": d.get("stats", {}), "fan": d.get("fan", {}),
                     "dropped": d.get("dropped", 0)}
    return out


def totals(runs, pset):
    t = {k: 0 for k, _ in FIELDS}
    t["dropped"] = 0
    t["fan_sites"] = t["fan_sound"] = t["fan_exact"] = 0
    n = 0
    for _, r in runs.items():
        if r["set"] != pset:
            continue
        n += 1
        for k, _ in FIELDS:
            t[k] += r["stats"].get(k, 0)
        t["dropped"] += r["dropped"]
        t["fan_sites"] += r["fan"].get("sites", 0)
        t["fan_sound"] += r["fan"].get("sound", 0)
        t["fan_exact"] += r["fan"].get("exact", 0)
    t["projects"] = n
    return t


def pct(a, b):
    return f"{100.0 * a / b:.2f}%" if b else "-"


def table(runs, pset):
    rows = [(n, r) for n, r in runs.items() if r["set"] == pset]
    if not rows:
        print(f"  {pset}: no projects scored")
        return None
    print(f"  {pset.upper()}  ({len(rows)} projects)")
    print(f"    {'project':<18} {'sites':>7} {'cover':>8} {'in-src':>7} {'agree':>8} "
          f"{'ext':>6} {'lbl':>7} {'fan-sound':>10} {'drop':>5} {'WRONG':>6}")
    for n, r in rows:
        s, f = r["stats"], r["fan"]
        print(f"    {n:<18} {s.get('held_sites',0):>7} "
              f"{pct(s.get('site_seen',0), s.get('held_sites',0)):>8} "
              f"{s.get('in_source_sites',0):>7} "
              f"{pct(s.get('declared_agree',0), s.get('in_source_sites',0)):>8} "
              f"{s.get('external_sites',0):>6} "
              f"{pct(s.get('external_labelled',0)+s.get('external_boundary_tier',0), s.get('external_sites',0)):>7} "
              f"{pct(f.get('sound',0), f.get('sites',0)):>10} "
              f"{r['dropped']:>5} {s.get('external_wrongly_resolved',0):>6}")
    t = totals(runs, pset)
    print(f"    {'TOTAL':<18} {t['held_sites']:>7} "
          f"{pct(t['site_seen'], t['held_sites']):>8} "
          f"{t['in_source_sites']:>7} "
          f"{pct(t['declared_agree'], t['in_source_sites']):>8} "
          f"{t['external_sites']:>6} "
          f"{pct(t['external_labelled'], t['external_sites']):>7} "
          f"{pct(t['fan_sound'], t['fan_sites']):>10} "
          f"{t['dropped']:>5} {t['external_wrongly_resolved']:>6}")
    return t


def one(work):
    runs = load(work)
    if not runs:
        sys.exit("aggregate: no score.json files found -- did the run produce any?")
    print("CORPUS SUMMARY")
    d = table(runs, "dev")
    print()
    h = table(runs, "holdout")
    bad = 0
    for t in (d, h):
        if t and (t["dropped"] or t["external_wrongly_resolved"]):
            bad = 1
    print()
    if bad:
        print("  VERDICT  FAIL -- a site was dropped or an external target was wrongly")
        print("           resolved. Both are defects, not imprecision.")
    else:
        print("  VERDICT  no defects (0 dropped, 0 wrongly resolved). Recall is the")
        print("           number to improve; see the tables above.")
    return bad


def rate(t, num, den):
    return (100.0 * t[num] / t[den]) if t and t[den] else None


def diff(before, after):
    b, a = load(before), load(after)
    print("CORPUS DIFF")
    verdict, reasons = "PASS", []
    for pset in ("dev", "holdout"):
        tb, ta = totals(b, pset), totals(a, pset)
        if not ta["projects"]:
            continue
        print(f"\n  {pset.upper()}")
        for num, den, what in (
            ("site_seen", "held_sites", "site coverage"),
            ("declared_agree", "in_source_sites", "declared agreement"),
            ("fan_sound", "fan_sites", "fan soundness"),
        ):
            rb, ra = rate(tb, num, den), rate(ta, num, den)
            if rb is None or ra is None:
                continue
            delta = ra - rb
            arrow = "+" if delta > 0.005 else ("-" if delta < -0.005 else "=")
            print(f"    {what:<22} {rb:7.2f}% -> {ra:7.2f}%  {arrow}{abs(delta):.2f}")
        for k, what in (("dropped", "dropped sites"),
                        ("external_wrongly_resolved", "wrongly resolved external")):
            if ta[k] > tb[k]:
                verdict = "FAIL"
                reasons.append(f"{pset}: {what} rose {tb[k]} -> {ta[k]}")
            elif ta[k] != tb[k]:
                print(f"    {what:<22} {tb[k]} -> {ta[k]}")
        if ta["fan_sound"] < tb["fan_sound"] and ta["fan_sites"] >= tb["fan_sites"]:
            verdict = "FAIL"
            reasons.append(f"{pset}: the fan lost {tb['fan_sound'] - ta['fan_sound']} sound site(s)")

    db = rate(totals(b, "dev"), "declared_agree", "in_source_sites")
    da = rate(totals(a, "dev"), "declared_agree", "in_source_sites")
    hb = rate(totals(b, "holdout"), "declared_agree", "in_source_sites")
    ha = rate(totals(a, "holdout"), "declared_agree", "in_source_sites")
    if None not in (db, da, hb, ha):
        dev_up, hold_up = da - db, ha - hb
        if dev_up > 0.01 and hold_up < -0.01:
            verdict = "FAIL"
            reasons.append(f"dev +{dev_up:.2f} while holdout {hold_up:.2f}: the rule fits the dev set")
        elif dev_up > 0.01 and abs(hold_up) <= 0.01:
            if verdict == "PASS":
                verdict = "WARN"
            reasons.append(f"dev +{dev_up:.2f} and holdout unchanged: no evidence it generalised")

    print(f"\n  VERDICT  {verdict}")
    for r in reasons:
        print(f"           {r}")
    return 1 if verdict == "FAIL" else 0


if __name__ == "__main__":
    if len(sys.argv) == 2:
        sys.exit(one(sys.argv[1]))
    if len(sys.argv) == 3:
        sys.exit(diff(sys.argv[1], sys.argv[2]))
    sys.exit("usage: aggregate.py <work-dir> | aggregate.py <before> <after>")
