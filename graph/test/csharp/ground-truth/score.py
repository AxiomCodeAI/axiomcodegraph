#!/usr/bin/env python3
"""
Score the C# engine against the Roslyn oracle.

WHAT IS BEING MEASURED, AND WHAT IS DELIBERATELY NOT.

The engine is run CLIENT-ONLY: it reads the project's own source and no dependency
IR. The oracle is compiled the same way, against reference assemblies only. So
every oracle site is labelled in_source or external, and the two are scored
differently because the engine is asked for different things:

  in_source   The engine must RESOLVE it, to the same declaration. Recall and
              precision are computed here and this is the number that matters.
  external    The engine must LABEL it, not resolve it. Scored as a labelling
              question: did the site reach the output as a named boundary.

THREE SEPARATE QUESTIONS, because collapsing them hides which one is failing:

  1. SITE COVERAGE. Did the engine see the call at all? An oracle site with no
     engine row is a site the parser or the engine dropped, and it is the worst
     failure because it is invisible downstream.

  2. DECLARED-TARGET AGREEMENT. The oracle reports the DECLARATION a call binds to,
     before dispatch. The engine's candidate is exactly that, so this compares like
     with like and isolates name resolution from dispatch.

  3. FAN SOUNDNESS AND PRECISION. The oracle's dispatch table gives, per concrete
     runtime type, the body that runs. The engine's resolved set must CONTAIN every
     one of those (soundness: a missing target is a wrong answer that looks right)
     and should contain few others (precision).

WHY SOUNDNESS IS REPORTED SEPARATELY FROM PRECISION: a fan that is too narrow
claims monomorphism the engine cannot support, and a reverse closure from the
missing target finds no caller. A fan that is too wide is merely imprecise. They
are different defects and a single F-score hides the one that matters.

COLUMN CONVENTION. The parser's startColumn is 0-BASED and Roslyn's is 1-based.
Verified on the probe project across seven sites, all exactly +1. The join adds one
to the engine's column, in one place, here.

THE JOIN KEY IS (FILE, LINE, COLUMN, CALLEE NAME), AND THE NAME IS NOT OPTIONAL.
A chained call puts SEVERAL sites at ONE position, because both Roslyn and the
parser anchor an invocation at the start of the whole invocation expression:

    : PascalizeRegex().Replace(input, ...)
      ^-- col 15 is BOTH PascalizeRegex() and Regex.Replace()

and `match.Groups[1].Value.ToUpperInvariant()` puts four at column 56. Joining on
position alone credited the inner call's resolution to the outer call's target and
reported 66 "wrongly resolved external" edges across the dev set -- every one of
them an artefact. The engine had resolved the inner call correctly and labelled the
outer one external, which is exactly right.

So each oracle row is matched to the engine site at its position whose callee name
agrees. Where a position holds ONE engine site the name is not required; where it
holds several and none agrees, that oracle row is a genuine miss for that call, and
is counted as one.

Usage:
  score.py --engine-raw <dir> --engine-ir <dir> --oracle <file.tsv>
           [--oracle-dispatch <file.tsv>] [--json <out.json>] [--verbose N]
"""
import argparse
import csv
import json
import os
import sys
from collections import Counter, defaultdict

# The oracle site kinds the engine is HELD TO. A kind outside this set is reported
# but does not count against recall, and each exclusion is a stated ruling rather
# than a convenience:
#
#   foreach_protocol    GetEnumerator/MoveNext/Current. Real calls the runtime makes,
#                       written nowhere. Both oracles agree they exist; the engine
#                       does not emit them and neither does the Java engine (it
#                       excludes the same triple). Counting them would make every
#                       foreach a miss for a construct no consumer asks about.
#   implicit_conversion An implicit user-defined conversion has NO SYNTAX at the call
#                       site. The parser reserves CONVERSION_CALL for it and emits
#                       nothing, by ruling, because syntax cannot decide it.
#   property_accessor   Held to, but reported separately: `x.Name` is a call to
#                       get_Name and the engine should emit it. Counted in its own
#                       bucket so the headline number is not dominated by a single
#                       construct.
HELD = {
    "invocation",
    "object_creation",
    "implicit_object_creation",
    "ctor_delegate",
    "primary_ctor_base",
    "indexer",
    "operator",
    "conversion",
    "event_accessor",
}
NOT_HELD = {"foreach_protocol", "implicit_conversion"}
# Property accessors are reported in their own bucket rather than in the headline
# number: there are more of them than ordinary invocations on a property-heavy
# codebase, so mixing them in would make the headline a statement about one
# construct. They are still scored, and the engine is still expected to emit them.
REPORTED_SEPARATELY = {"property_accessor"}


def read_tsv(path, required=True):
    if not os.path.exists(path):
        if required:
            sys.exit(f"score: missing {path}")
        return []
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh, delimiter="\t"))


def read_raw(path):
    """A souffle .output file: TSV, no header."""
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as fh:
        return [r for r in csv.reader(fh, delimiter="\t") if r]


def engine_keys(ir_dir):
    """
    Engine hash -> the oracle's key shape, and expression hash -> (file, line, col).

    The oracle's key is `<containing type fully qualified>.<name>/<param count>`, with
    a constructor named `<constructor>`. The engine's method row carries
    qualifiedName (`Probe.Circle.<constructor>`) and parameterCount, so the key is
    built rather than matched textually -- a parser change to qualifiedName's spelling
    would otherwise read as a total scoring failure.
    """
    meth, expr, mods = {}, {}, {}
    callee = {}
    with open(os.path.join(ir_dir, "all-csharp-modules.csv"), newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            mods[r["csModuleUniqueHash"]] = r["filePath"]
    with open(os.path.join(ir_dir, "all-csharp-methods.csv"), newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            qn, pc = r["qualifiedName"], r["parameterCount"]
            meth[r["csMethodUniqueHash"]] = f"{qn}/{pc}"
    with open(os.path.join(ir_dir, "all-csharp-expressions.csv"), newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            expr[r["csExpressionUniqueHash"]] = (
                mods.get(r["csModuleLinkHash"], ""),
                int(r["startLine"] or 0),
                int(r["startColumn"] or 0) + 1,   # 0-based -> 1-based, once, here
            )
    cs = os.path.join(ir_dir, "all-csharp-call-sites.csv")
    if os.path.exists(cs):
        with open(cs, newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh, delimiter="\t"):
                callee[r["csExpressionLinkHash"]] = (r["calleeName"] or "", r["callKind"] or "")
    return meth, expr, mods, callee


def norm_key(k):
    """
    Normalise a key for comparison. The oracle writes a generic type as
    `List<T>` and the engine writes `List`; a constructor is `.ctor` in Roslyn's
    display and `<constructor>` in the engine. Both sides are reduced to the same
    shape rather than one being taught the other's spelling.
    """
    if not k:
        return ""
    k = k.replace(".ctor/", ".<constructor>/")
    # A PRIMARY CONSTRUCTOR IS A CONSTRUCTOR. The parser names it
    # `<primary-constructor>` and Roslyn reports `.ctor`, so a positional record's
    # `new Point(1, 2)` compared as a DISAGREEMENT while the engine had resolved it
    # to exactly the right method.
    k = k.replace(".<primary-constructor>/", ".<constructor>/")
    # AN INDEXER ACCESSOR IS NAMED DIFFERENTLY ON THE TWO SIDES. The parser names the
    # indexer `this[]` and its getter `get_this[]` with parameterCount 0; Roslyn
    # reports `get_Item` with 1. Both identify the same accessor and neither spelling
    # is wrong, so both reduce to `get_Item` with the arity dropped -- a property has
    # exactly one getter and one setter, so the count adds nothing to the identity.
    for acc in ("get", "set"):
        for spelling in (f".{acc}_this[]/", f".{acc}_Item/"):
            if spelling in k:
                k = k.split(spelling)[0] + f".{acc}_Item"
                break
    # `<constructor>` is a NAME here, not a generic argument list. Stripping angle
    # brackets naively removed it and turned `Type.<constructor>/1` into `Type./1`,
    # so every constructor comparison read as a disagreement -- 33 of them on
    # one member alone, all spurious. Parked behind a sentinel, stripped, restored.
    k = k.replace("<constructor>", "\x00ctor\x00")
    out, depth = [], 0
    for ch in k:
        if ch == "<":
            depth += 1
            continue
        if ch == ">":
            if depth:
                depth -= 1
            continue
        if depth:
            continue
        out.append(ch)
    return "".join(out).replace("\x00ctor\x00", "<constructor>")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine-raw", required=True)
    ap.add_argument("--engine-ir", required=True)
    ap.add_argument("--oracle", required=True)
    ap.add_argument("--oracle-dispatch")
    ap.add_argument("--json")
    ap.add_argument("--label", default="")
    ap.add_argument("--verbose", type=int, default=0, help="print N examples per failure class")
    a = ap.parse_args()

    meth, expr, _, callee = engine_keys(a.engine_ir)

    # ── the engine's answers, keyed by position ───────────────────────────────
    # Every engine site is keyed by (position, callee name). A chained call puts
    # several at one position, so the name is what tells them apart.
    def site_key(exprhash):
        pos = expr.get(exprhash)
        if not pos:
            return None
        name, _kind = callee.get(exprhash, ("", ""))
        return pos + (name,)

    cand = defaultdict(set)      # (pos, name) -> {declared key}
    resolved = defaultdict(set)  # (pos, name) -> {runtime key}
    at_pos = defaultdict(set)    # pos -> {names the engine has a site for}
    for row in read_raw(os.path.join(a.engine_raw, "expression-call-candidate.csv")):
        if len(row) < 3 or row[0] != "client":
            continue
        k = site_key(row[1])
        if k:
            cand[k].add(norm_key(meth.get(row[2], row[2])))
            at_pos[k[:3]].add(k[3])
    for row in read_raw(os.path.join(a.engine_raw, "expression-resolves-to-method.csv")):
        if len(row) < 3 or row[0] != "client":
            continue
        k = site_key(row[1])
        if k:
            resolved[k].add(norm_key(meth.get(row[2], row[2])))
            at_pos[k[:3]].add(k[3])

    # ACCESSOR EDGES ARE ENGINE ANSWERS. `x.Name` invokes get_Name and `a[i]` an
    # indexer accessor; those sites are MEMBER_ACCESS / ELEMENT_ACCESS expressions
    # with no cs_call_site row, so they never appear in the candidate or resolved
    # relations. Reading only those made every accessor site look like one the engine
    # had not seen -- 3 of 4 held sites in the accessor case, reported as
    # `site_missed` while the edges were in call-chain-edges.csv.
    #
    # Keyed by the ACCESSOR'S OWN NAME (`get_Item`, `add_Changed`), which is what
    # Roslyn reports, so the join needs no special case.
    for row in read_raw(os.path.join(a.engine_raw, "accessor-edges.csv")):
        if len(row) < 4 or row[0] != "client":
            continue
        pos = expr.get(row[1])
        if not pos:
            continue
        target = norm_key(meth.get(row[2], row[2]))
        nm = target.rsplit("/", 1)[0].rsplit(".", 1)[-1]
        k = pos + (nm,)
        resolved[k].add(target)
        at_pos[pos].add(nm)

    # A GENERATED RECORD PROPERTY READ is an accessor edge too. Its target is a
    # LABEL (`generated:Type.get_Name`) because the compiler generated the accessor
    # and the parser emits no method row for it, so it cannot be keyed like the
    # others; the label already carries the name the oracle uses.
    for row in read_raw(os.path.join(a.engine_raw, "generated-accessor-read.csv")):
        if len(row) < 3 or row[0] != "client":
            continue
        pos = expr.get(row[1])
        if not pos:
            continue
        nm = row[2].rsplit(".", 1)[-1]        # get_Name
        resolved[pos + (nm,)].add(row[2].split("generated:", 1)[-1])
        at_pos[pos].add(nm)

    # every site that reached the output, with its tier, and the external labels
    tier, external = {}, defaultdict(set)
    for row in read_raw(os.path.join(a.engine_raw, "call-class.csv")):
        if len(row) < 3 or row[0] != "client":
            continue
        k = site_key(row[1])
        if k:
            tier[k] = row[2]
            at_pos[k[:3]].add(k[3])
    for row in read_raw(os.path.join(a.engine_raw, "call-edges-external.csv")):
        if len(row) < 2:
            continue
        k = site_key(row[0])
        if k:
            external[k].add(row[1])
            at_pos[k[:3]].add(k[3])

    # A PROPERTY READ ON AN EXTERNAL RECEIVER is labelled, not resolved, and its
    # label already carries the accessor name the oracle uses.
    for row in read_raw(os.path.join(a.engine_raw, "external-property-read.csv")):
        if len(row) < 3 or row[0] != "client":
            continue
        pos = expr.get(row[1])
        if not pos:
            continue
        nm = row[2].rsplit(".", 1)[-1]
        external[pos + (nm,)].add(row[2])
        at_pos[pos].add(nm)

    dropped = len(read_raw(os.path.join(a.engine_raw, "call-site-dropped.csv")))

    # ── the oracle ───────────────────────────────────────────────────────────
    oracle = read_tsv(a.oracle)

    # Engine sites indexed by (file, line), for the null-conditional fallback above.
    by_line = defaultdict(list)
    for _p, _nms in at_pos.items():
        for _nm in _nms:
            by_line[(_p[0], _p[1])].append(_p + (_nm,))

    def oracle_name(r):
        """
        The name the ENGINE would write for this oracle row's call site.

        They differ for two shapes and matching them is the whole point of the key:
        a constructor is `.ctor` to Roslyn and the TYPE NAME at a `new Foo(...)`
        site, and an operator is `op_Addition` to Roslyn and the operator token in
        the source. Anything else is the member's own name in both.
        """
        n = r["targetName"]
        if n in (".ctor", "<constructor>"):
            t = r["targetContainingType"] or ""
            t = t.split("<")[0]
            return t.rsplit(".", 1)[-1]
        return n


    def engine_site_for(pos, name, group_size, rows=()):
        """
        The engine site key for ONE oracle row, or None.

        Keyed on (position, callee name), because a chained call puts several sites
        at one position: `Configurator.Get(c).Convert(w)` has both `Get` and
        `Convert` anchored at the same column, and so does `PascalizeRegex().Replace()`.
        Requiring a UNIQUE name intersection across the group was wrong for exactly
        the case the key exists to handle -- when both names match, the intersection
        has two members and every row at the position read as a missing site.

        The fallback covers a legitimate name difference on an unambiguous position:
        the parser's calleeName and Roslyn's member name are not always the same
        word (an explicit interface implementation, an operator, a generated
        accessor), and refusing to match a position holding exactly one site on each
        side would invent a miss.
        """
        names = at_pos.get(pos, set())
        if name in names:
            return pos + (name,)
        # A TARGET-TYPED `new()` HAS NO WRITTEN NAME. The parser records a
        # CONSTRUCTOR_CALL with an empty calleeName because there is nothing to
        # record -- the type comes from the assignment target. Roslyn names the
        # inferred type, so the two can never agree on a name and the empty one is
        # matched by KIND instead.
        if "" in names and any(r["siteKind"] == "implicit_object_creation" for r in rows):
            return pos + ("",)
        # THE SINGLE-SITE SHORTCUT DOES NOT APPLY TO A SYNTHESISED ACCESSOR NAME.
        # `get_Chars`, `op_Inequality`, `add_Changed` are names the compiler makes up,
        # and BOTH sides make up the same ones -- so where they disagree, they are
        # genuinely different calls rather than two spellings of one.
        #
        # `Value[index]` puts a property read (`get_Value`) and an indexer access
        # (`get_Chars`) at ONE position, and `AccountId != Guid.Empty` puts a property
        # read and an operator there. Letting the shortcut pair them reported the
        # engine as having resolved an external target to an in-source method: 8
        # "wrongly resolved" edges across the holdout set, every one of them a pairing
        # this function invented.
        synth = name.startswith(("get_", "set_", "add_", "remove_", "op_"))
        only = next(iter(names)) if len(names) == 1 else None
        only_synth = bool(only) and only.startswith(("get_", "set_", "add_", "remove_", "op_"))
        if len(names) == 1 and group_size == 1 and not (synth or only_synth):
            return pos + (next(iter(names)),)
        # A NULL-CONDITIONAL CALL IS ANCHORED DIFFERENTLY ON THE TWO SIDES.
        # `Changed?.Invoke(this, e)` -- the parser anchors the site at the start of the
        # conditional access (`Changed`) and Roslyn at the invocation (`Invoke`), so
        # the columns differ by the length of the receiver. Both conventions are
        # defensible and neither is a resolution outcome, so the join falls back to
        # (file, line, name) and requires the name to be UNIQUE on that line: two
        # calls of one name on one line get no match rather than a guessed one.
        cands = [k for k in by_line.get((pos[0], pos[1]), ()) if k[3] == name]
        if len(cands) == 1:
            return cands[0]
        return None

    # ── SCORED PER ORACLE ROW, grouped by (position, name) ───────────────────
    # One position may hold several calls; one (position, name) is one call. Rows
    # that share the key are the same call reported under several site kinds (an
    # indexer that is also a property access), and they are scored once.
    by_call = defaultdict(list)
    for r in oracle:
        pos = (r["filePath"], int(r["line"]), int(r["column"]))
        by_call[(pos, oracle_name(r))].append(r)

    group_at = Counter(pos for (pos, _n) in by_call)

    stats = Counter()
    fails = defaultdict(list)
    per_kind = defaultdict(Counter)

    for (pos, name), rows in by_call.items():
        kinds = {r["siteKind"] for r in rows}
        if kinds & NOT_HELD and not (kinds & HELD):
            stats["not_held_sites"] += 1
            continue
        held = [r for r in rows if r["siteKind"] in HELD]
        prop = [r for r in rows if r["siteKind"] in REPORTED_SEPARATELY]
        if prop and not held:
            stats["property_sites"] += 1
            if at_pos.get(pos):
                stats["property_sites_seen"] += 1
            continue
        # `new Foo()` WHERE Foo DECLARES NO CONSTRUCTOR. Roslyn reports the
        # compiler-synthesised parameterless constructor, which is in-source by its
        # reckoning because it is a member of a source type. There is no user code to
        # call and no parser row to point at, so the engine emits the site with the
        # tier known_implicit_ctor and no callee -- which is the truthful answer, not
        # a miss. Counted in its own bucket, on the same footing as foreach_protocol.
        if (len(held) == 1 and held[0]["siteKind"] in ("object_creation", "implicit_object_creation")
                and held[0]["targetParamCount"] == "0"
                and tier.get(pos + (name,)) == "known_implicit_ctor"):
            stats["implicit_default_ctor"] += 1
            continue
        # A FIELD-LIKE EVENT'S ACCESSORS ARE COMPILER-GENERATED. `public event
        # EventHandler Changed;` declares no add/remove body, so the parser emits a
        # cs_event row and NO accessor methods -- there is nothing for the engine to
        # point at. Roslyn reports add_Changed as an in-source target because it is a
        # member of a source type, exactly as it does for an implicit default
        # constructor, and the ruling is the same: the engine saying nothing is
        # truthful, so it is counted in its own bucket rather than as a miss.
        if len(held) == 1 and held[0]["siteKind"] == "event_accessor" and name.startswith(("add_", "remove_")):
            stats["field_like_event_accessor"] += 1
            continue
        if not held:
            stats["unclassified_sites"] += 1
            continue

        stats["held_sites"] += 1
        in_source = [r for r in held if r["targetWhere"] == "in_source"]
        ext = [r for r in held if r["targetWhere"] == "external"]
        kind = held[0]["siteKind"]
        per_kind[kind]["oracle"] += 1

        ek = engine_site_for(pos, name, group_at[pos], held)
        seen = ek is not None and (ek in cand or ek in resolved or ek in external or ek in tier)
        if not seen:
            stats["site_missed"] += 1
            per_kind[kind]["missed"] += 1
            fails["site_missed"].append((pos, name, kind, held[0]["targetKey"]))
            continue
        stats["site_seen"] += 1
        per_kind[kind]["seen"] += 1

        if in_source:
            stats["in_source_sites"] += 1
            want = {norm_key(r["targetKey"]) for r in in_source}
            got = cand.get(ek) or resolved.get(ek, set())
            if want & got:
                stats["declared_agree"] += 1
                per_kind[kind]["declared_agree"] += 1
                if got - want:
                    stats["declared_extra"] += 1
            elif got:
                stats["declared_differs"] += 1
                fails["declared_differs"].append((pos, name, kind, sorted(want), sorted(got)[:8]))
            else:
                stats["declared_none"] += 1
                fails["declared_none"].append((pos, name, kind, sorted(want), tier.get(ek, "-")))
        if ext:
            stats["external_sites"] += 1
            if ek in external:
                stats["external_labelled"] += 1
            elif tier.get(ek) in ("boundary_lib", "ambiguous_dynamic", "known_implicit_ctor"):
                stats["external_boundary_tier"] += 1
            elif ek in resolved:
                # The engine resolved a call the oracle says leaves the source. A
                # WRONG EDGE, not an imprecise one: it names a target in the project
                # that the compiler does not call.
                stats["external_wrongly_resolved"] += 1
                fails["external_wrongly_resolved"].append((pos, name, kind, held[0]["targetKey"], sorted(resolved[ek])[:6]))
            else:
                stats["external_unlabelled"] += 1
                fails["external_unlabelled"].append((pos, name, kind, held[0]["targetKey"], tier.get(ek, "-")))

    # sites the ENGINE emitted that the oracle has no row for
    oracle_keys = set(by_call)
    for k in set(tier) | set(cand):
        if (k[:3], k[3]) not in oracle_keys and k[:3] not in {p for p, _ in oracle_keys}:
            stats["engine_only_sites"] += 1
            fails["engine_only"].append((k, tier.get(k, "-"), sorted(cand.get(k, ()))))

    # ── the dispatch fan ─────────────────────────────────────────────────────
    fan = {}
    if a.oracle_dispatch:
        want_fan = defaultdict(set)
        for r in read_tsv(a.oracle_dispatch, required=False):
            if r["runtimeWhere"] == "in_source":
                want_fan[norm_key(r["declaredKey"])].add(norm_key(r["runtimeKey"]))
        fs = Counter()
        fan_fails = []
        for (pos, name), rows in by_call.items():
            held = [r for r in rows if r["siteKind"] in HELD and r["targetWhere"] == "in_source"]
            if not held:
                continue
            ek = engine_site_for(pos, name, group_at[pos], held)
            if ek is None or ek not in resolved:
                continue
            for r in held:
                # A SITE THE ORACLE ITSELF SAYS IS NOT VIRTUALLY DISPATCHED must not be
                # scored against the fan. `base.Describe()` runs the base body and no
                # override, so the engine resolving it to exactly that is right and
                # holding it to the full fan counted the correct answer as a lost
                # target. The oracle marks the site, not just the member.
                if r["targetDispatch"] != "virtual":
                    fs["non_virtual_sites"] += 1
                    continue
                dk = norm_key(r["targetKey"])
                if dk not in want_fan:
                    continue
                fs["sites"] += 1
                want, got = want_fan[dk], resolved[ek]
                missing, extra = want - got, got - want - {dk}
                if not missing:
                    fs["sound"] += 1
                else:
                    fs["unsound"] += 1
                    fan_fails.append((pos, dk, sorted(missing), sorted(got)[:12]))
                if not extra:
                    fs["exact"] += 1
                fs["want_total"] += len(want)
                fs["got_total"] += len(got)
        fan = dict(fs)
        if fan_fails:
            fails["fan_unsound"] = fan_fails

    # ── report ───────────────────────────────────────────────────────────────
    s = stats
    held_n = s["held_sites"] or 1
    insrc_n = s["in_source_sites"] or 1
    ext_n = s["external_sites"] or 1
    label = f" [{a.label}]" if a.label else ""
    print(f"== C# engine vs Roslyn oracle{label} ==")
    print(f"  oracle sites held to      {s['held_sites']}")
    print(f"    site coverage           {s['site_seen']}/{s['held_sites']}  {100*s['site_seen']/held_n:.2f}%")
    print(f"    dropped by the engine   {dropped}   (must be 0)")
    print(f"  in-source targets         {s['in_source_sites']}")
    print(f"    declared agrees         {s['declared_agree']}/{s['in_source_sites']}  {100*s['declared_agree']/insrc_n:.2f}%")
    print(f"    declared differs        {s['declared_differs']}")
    print(f"    resolved to nothing     {s['declared_none']}")
    print(f"    extra candidates        {s['declared_extra']}")
    print(f"  external targets          {s['external_sites']}")
    print(f"    labelled external       {s['external_labelled']}")
    print(f"    boundary tier only      {s['external_boundary_tier']}")
    print(f"    WRONGLY RESOLVED        {s['external_wrongly_resolved']}   (a wrong edge)")
    print(f"    unlabelled              {s['external_unlabelled']}")
    if fan:
        fsites = fan.get("sites", 0) or 1
        print(f"  dispatch fan              {fan.get('sites', 0)} sites with in-source fans")
        print(f"    sound (no target lost)  {fan.get('sound',0)}/{fan.get('sites',0)}  {100*fan.get('sound',0)/fsites:.2f}%")
        print(f"    exact (nothing extra)   {fan.get('exact',0)}/{fan.get('sites',0)}  {100*fan.get('exact',0)/fsites:.2f}%")
        print(f"    oracle targets / engine {fan.get('want_total',0)} / {fan.get('got_total',0)}")
        print(f"    non-virtual sites       {fan.get('non_virtual_sites',0)} not held to a fan")
    print(f"  not held (by ruling)      {s['not_held_sites']} foreach/implicit-conversion, "
          f"{s['implicit_default_ctor']} compiler-synthesised default ctors, "
          f"{s['field_like_event_accessor']} field-like event accessors")
    print(f"  property accessors        {s['property_sites']} sites, {s['property_sites_seen']} seen by the engine")
    print(f"  engine-only sites         {s['engine_only_sites']}")

    if a.verbose:
        for cls, items in sorted(fails.items()):
            if not items:
                continue
            print(f"\n  -- {cls} ({len(items)}) --")
            for it in items[: a.verbose]:
                print(f"     {it}")

    if a.json:
        os.makedirs(os.path.dirname(os.path.abspath(a.json)), exist_ok=True)
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump({"label": a.label, "stats": dict(s), "dropped": dropped,
                       "fan": fan, "per_kind": {k: dict(v) for k, v in per_kind.items()}},
                      fh, indent=1, sort_keys=True)

    # A dropped site or a wrong external edge is a hard failure. Recall is a number
    # to improve; those two are defects.
    return 1 if (dropped or s["external_wrongly_resolved"]) else 0


if __name__ == "__main__":
    sys.exit(main())
