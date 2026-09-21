#!/usr/bin/env python3
"""
Self-test for score.py: THE JOIN, NOT THE ENGINE.

score.py is the only thing standing between a rule change and a number, and two of
its verdicts are GATES rather than measurements -- a dropped site and a wrongly
resolved external target each fail the run and the corpus aggregate. A gate that
fires on an artefact of the join cannot guard a real regression, and every artefact
found so far was found by reading a failure listing rather than by a test.

The cases here are the join's own edges. They are written as SYNTHETIC IR and
synthetic oracle rows because the shapes that break the join are shapes the engine
cannot currently produce -- an explicit interface implementation is not a dispatch
target yet, and an element access on an unstaged receiver emits nothing -- so a
case under cases/ would fail for the engine's reason and prove nothing about the
scorer. The column headers below are the real ones, copied from a real run, so a
fixture cannot drift into a shape the parser never writes.

EVERY CASE CARRIES ITS CONTROL. A test that only shows the bad pairing gone would
pass just as well if the join stopped pairing anything, so each one asserts the
legitimate pairing at the same position still scores.

    ./score-selftest.py [-v]

Exit status: 0 if every case passes, 1 otherwise. Needs python3 and nothing else.
"""
import csv
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCORE = os.path.join(HERE, "score.py")

# The real headers, from a real parser run. Only a few columns are read, but the
# fixture is written with the full header so a reader can see it is the same file
# the engine consumes and not a reduced invention.
IR = {
    "all-csharp-modules.csv": (
        "name qualifiedName fileName filePath baseMservPath namespaceStyle namespaceCount "
        "targetFramework defineConstantsKey langVersion nullableContextDefault "
        "hasTopLevelStatements implicitUsingsEnabled projectPath assemblyName emissionRegime "
        "grammarRegime startLine endLine parseErrorCount parseErrorBytes isGeneratedOutput "
        "csModuleInitMethodLinkHash isExternal serviceVersionLinkHash csModuleUniqueHash"
    ).split(),
    "all-csharp-methods.csv": (
        "name qualifiedName arity signature methodKind returnTypeName methodAccess "
        "methodModifiers isStatic isAbstract isVirtual isOverride isSealed isAsync isIterator "
        "isExtension isPartialDefinition isPartialImplementation explicitInterfaceName "
        "operatorToken conversionKind csModuleLinkHash csTypeLinkHash isAccessor "
        "ownerMemberLinkHash ownerMemberKind parameterCount startLine endLine startColumn "
        "bodyKind attributeCount isExternal serviceVersionLinkHash csMethodUniqueHash"
    ).split(),
    "all-csharp-expressions.csv": (
        "kind edgeRole rootContext expressionOwnerKind expressionOwnerHash parentExpressionHash "
        "position depth csTypeLinkHash csModuleLinkHash literalKind literalValue operatorString "
        "unaryFixity methodReferenceKind referencedEntityKind referencedEntityHash "
        "anonymousDeclarationHash potentialQualifiedName isAmbiguous argumentCount "
        "typeArgumentCount isSpread isNullConditional isNullForgiving castTypeReferenceLinkHash "
        "isCheckedContext returnStatementIndex startLine startColumn endLine endColumn isExternal "
        "serviceVersionLinkHash csExpressionUniqueHash"
    ).split(),
    "all-csharp-types.csv": (
        "name qualifiedName arity typeCategory typeAccess typeModifiers typePlacement "
        "declarationScopeKey declarationGroupKey isPartial isStatic isAbstract isSealed "
        "isReadOnly isRefLikeStruct isFileLocal isRecord hasPrimaryConstructor "
        "primaryConstructorArity nullableContext csModuleLinkHash containingTypeLinkHash "
        "csNamespaceName startLine endLine startColumn attributeCount isExternal "
        "serviceVersionLinkHash csTypeUniqueHash"
    ).split(),
        "all-csharp-call-sites.csv": (
        "callKind calleeName receiverKind receiverExpressionLinkHash receiverTypeName "
        "csExpressionLinkHash csModuleLinkHash callerMethodLinkHash callerTypeLinkHash "
        "argumentCount namedArgumentCount typeArgumentCount refArgumentCount outArgumentCount "
        "isConditional isQueryDesugarCandidate startLine startColumn isExternal "
        "serviceVersionLinkHash"
    ).split(),
}

ORACLE_COLS = (
    "filePath line column siteKind targetWhere targetKey targetContainingType targetName "
    "targetParamCount targetDispatch targetStatic targetExtension callerKey"
).split()

DISPATCH_COLS = "declaredKey runtimeType runtimeKey runtimeWhere how".split()


class Fixture:
    """One synthetic run: an IR directory, a raw engine directory and an oracle."""

    def __init__(self, root):
        self.root = root
        self.ir = os.path.join(root, "ir")
        self.raw = os.path.join(root, "raw")
        os.makedirs(self.ir)
        os.makedirs(self.raw)
        self.rows = {name: [] for name in IR}
        self.raw_rows = {}
        self.oracle = []
        self.dispatch = []
        self.manifest = None

    # ── the IR the engine reads ──────────────────────────────────────────────
    def module(self, h, path):
        self.rows["all-csharp-modules.csv"].append(
            {"csModuleUniqueHash": h, "filePath": path, "fileName": os.path.basename(path)})
        return h

    def method(self, h, qualified_name, param_count, **extra):
        row = {"csMethodUniqueHash": h, "qualifiedName": qualified_name,
               "parameterCount": str(param_count)}
        row.update(extra)
        self.rows["all-csharp-methods.csv"].append(row)
        return h

    def expression(self, h, module, line, column, kind="INVOCATION"):
        # score.py turns the parser's 0-based column into Roslyn's 1-based one, so a
        # fixture writes the PARSER's column and the oracle row is written at +1.
        self.rows["all-csharp-expressions.csv"].append(
            {"csExpressionUniqueHash": h, "csModuleLinkHash": module, "kind": kind,
             "startLine": str(line), "startColumn": str(column)})
        return h

    def interface_type(self, h, qualified_name):
        """An interface the IR declares, which is how the key builder resolves an
        `explicitInterfaceName` to the QUALIFIED spelling the oracle writes."""
        self.rows["all-csharp-types.csv"].append(
            {"csTypeUniqueHash": h, "qualifiedName": qualified_name,
             "name": qualified_name.rsplit(".", 1)[-1], "typeCategory": "INTERFACE"})
        return h

    def call_site(self, expr, callee_name, call_kind="METHOD_CALL"):
        self.rows["all-csharp-call-sites.csv"].append(
            {"csExpressionLinkHash": expr, "calleeName": callee_name, "callKind": call_kind})

    # ── the engine's answers ─────────────────────────────────────────────────
    def raw_row(self, relation, *cols):
        self.raw_rows.setdefault(relation, []).append([str(c) for c in cols])

    def candidate(self, expr, method):
        self.raw_row("expression-call-candidate.csv", "client", expr, method)

    def resolves(self, expr, method):
        self.raw_row("expression-resolves-to-method.csv", "client", expr, method)

    def classify(self, expr, tier):
        self.raw_row("call-class.csv", "client", expr, tier)

    def accessor_edge(self, expr, method, edge_kind):
        """`edge_kind` is the engine's own column 4: indexer / property_read / property_write."""
        self.raw_row("accessor-edges.csv", "client", expr, method, edge_kind)

    def external_label(self, expr, label):
        self.raw_row("call-edges-external.csv", expr, label)

    # ── the ground truth ─────────────────────────────────────────────────────
    def oracle_row(self, path, line, column, site_kind, where, target_key, **extra):
        row = {"filePath": path, "line": str(line), "column": str(column),
               "siteKind": site_kind, "targetWhere": where, "targetKey": target_key,
               "targetName": target_key.rsplit("/", 1)[0].rsplit(".", 1)[-1],
               "targetContainingType": target_key.rsplit("/", 1)[0].rsplit(".", 1)[0],
               "targetParamCount": target_key.rsplit("/", 1)[-1],
               "targetDispatch": "static_bound", "targetStatic": "instance",
               "targetExtension": "", "callerKey": ""}
        row.update(extra)
        self.oracle.append(row)

    def dispatch_row(self, declared_key, runtime_type, runtime_key,
                     where="in_source", how="virtual"):
        self.dispatch.append({"declaredKey": declared_key, "runtimeType": runtime_type,
                              "runtimeKey": runtime_key, "runtimeWhere": where, "how": how})

    def manifest_lines(self, lines):
        self.manifest = lines

    # ── run ──────────────────────────────────────────────────────────────────
    def score(self, extra_args=()):
        for name, cols in IR.items():
            with open(os.path.join(self.ir, name), "w", newline="", encoding="utf-8") as fh:
                w = csv.DictWriter(fh, fieldnames=cols, delimiter="\t",
                                   restval="", extrasaction="raise")
                w.writeheader()
                for row in self.rows[name]:
                    w.writerow(row)
        for name, rows in self.raw_rows.items():
            with open(os.path.join(self.raw, name), "w", newline="", encoding="utf-8") as fh:
                csv.writer(fh, delimiter="\t", lineterminator="\n").writerows(rows)

        oracle_path = os.path.join(self.root, "oracle.tsv")
        with open(oracle_path, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=ORACLE_COLS, delimiter="\t", restval="")
            w.writeheader()
            for row in self.oracle:
                w.writerow(row)
        dispatch_path = os.path.join(self.root, "oracle.dispatch.tsv")
        with open(dispatch_path, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=DISPATCH_COLS, delimiter="\t", restval="")
            w.writeheader()
            for row in self.dispatch:
                w.writerow(row)
        if self.manifest is not None:
            with open(os.path.join(self.root, "oracle.manifest.tsv"), "w",
                      encoding="utf-8") as fh:
                fh.write("".join(f"{line}\n" for line in self.manifest))

        out_json = os.path.join(self.root, "score.json")
        proc = subprocess.run(
            [sys.executable, SCORE, "--engine-raw", self.raw, "--engine-ir", self.ir,
             "--oracle", oracle_path, "--oracle-dispatch", dispatch_path,
             "--json", out_json, *extra_args],
            capture_output=True, text=True)
        with open(out_json, encoding="utf-8") as fh:
            result = json.load(fh)
        result["_rc"] = proc.returncode
        result["_stdout"] = proc.stdout + proc.stderr
        return result


# ═════════════════════════════════════════════════════════════════════════════
# THE CASES
# ═════════════════════════════════════════════════════════════════════════════

def case_unparsable_file_is_not_scored(fx):
    """
    #1063. A ground-truth row from a file the oracle could NOT PARSE is not evidence
    about the engine, and scoring it charges the engine with disagreeing.

    Recovery from a syntax error invents structure: a member-declaration form past
    the pinned LanguageVersion closes its containing class early and the rest of the
    file is re-read as top-level statements, whose synthesised container is
    `Program`. The engine names the real containing type and is scored as wrong.

    CONTROL, in the same run: `Clean.cs` parses, and its row must still be scored
    and must still agree -- so a test that passes because the scorer stopped scoring
    anything fails here.
    """
    m_bad = fx.module("modBad", "Recovered.cs")
    m_ok = fx.module("modOk", "Clean.cs")
    fx.method("mBad", "Tools.Helper", 1)
    fx.method("mOk", "Probe.Control.Inner", 1)

    e_bad = fx.expression("eBad", m_bad, 10, 36)
    fx.call_site(e_bad, "Helper")
    fx.candidate(e_bad, "mBad")
    fx.classify(e_bad, "client_calls_client")

    e_ok = fx.expression("eOk", m_ok, 6, 44)
    fx.call_site(e_ok, "Inner")
    fx.candidate(e_ok, "mOk")
    fx.classify(e_ok, "client_calls_client")

    # What Roslyn writes: the fabricated `Program` container in the unparsable file,
    # the true one in the clean file.
    fx.oracle_row("Recovered.cs", 10, 37, "invocation", "in_source", "Program.Helper/1")
    fx.oracle_row("Clean.cs", 6, 45, "invocation", "in_source", "Probe.Control.Inner/1")
    fx.manifest_lines(["compileErrors\t10", "filesWithCompileErrors\t1",
                       "filesWithSyntaxErrors\t1", "errorFile\tRecovered.cs",
                       "recoveredFile\tRecovered.cs"])

    r = fx.score()
    s = r["stats"]
    yield "the unparsable file's row is not scored", s["held_sites"] == 1, s
    yield "the clean file's row still is", s["in_source_sites"] == 1, s
    yield "and still agrees", s["declared_agree"] == 1, s
    yield "nothing is charged as a disagreement", s.get("declared_differs", 0) == 0, s
    yield "the exclusion is reported, not silent", r["unparsable_rows"] == 1, r["unparsable_rows"]
    yield "and named in the report", "UNSCORED" in r["_stdout"], r["_stdout"]


def case_binding_errors_are_still_scored(fx):
    """
    #1063, the OTHER HALF. A subject compiled against reference assemblies only has
    thousands of unresolved-type errors BY DESIGN, and the rows it still produces are
    sound -- that is what the external bucket is for. Only a syntax error fabricates
    structure.

    Here the file is in `errorFile` (it did not bind) but NOT in `recoveredFile` (it
    parsed). Its row must still be scored. Without this case the fix could exclude
    every file with any diagnostic and still look correct.
    """
    m = fx.module("mod", "Binding.cs")
    fx.method("m1", "Probe.Binder.Inner", 1)
    e = fx.expression("e1", m, 7, 55)
    fx.call_site(e, "Inner")
    fx.candidate(e, "m1")
    fx.classify(e, "client_calls_client")
    fx.oracle_row("Binding.cs", 7, 56, "invocation", "in_source", "Probe.Binder.Inner/1")
    fx.manifest_lines(["compileErrors\t1", "filesWithCompileErrors\t1",
                       "filesWithSyntaxErrors\t0", "topErrorCodes\tCS0246:1",
                       "errorFile\tBinding.cs"])

    r = fx.score()
    s = r["stats"]
    yield "a file that did not BIND is still scored", s["held_sites"] == 1, s
    yield "and agrees", s["declared_agree"] == 1, s
    yield "nothing was excluded", r["unparsable_rows"] == 0, r["unparsable_rows"]


def case_missing_manifest_says_so(fx):
    """
    #1063. An older oracle build writes no manifest. Scoring everything is the right
    fallback -- it is what the scorer did before -- but silence about it is not:
    "no file was excluded" and "there was nothing to exclude" would read the same.
    """
    m = fx.module("mod", "A.cs")
    fx.method("m1", "N.T.M", 0)
    e = fx.expression("e1", m, 3, 10)
    fx.call_site(e, "M")
    fx.candidate(e, "m1")
    fx.classify(e, "client_calls_client")
    fx.oracle_row("A.cs", 3, 11, "invocation", "in_source", "N.T.M/0")
    # no manifest written at all

    r = fx.score()
    yield "everything is still scored", r["stats"]["held_sites"] == 1, r["stats"]
    yield "and the absence is printed", "no oracle manifest" in r["_stdout"], r["_stdout"]


def case_indexer_row_does_not_pair_with_a_property_named_Item(fx):
    """
    #1060. `get_Item` is the compiler's name for BOTH an indexer accessor and the
    getter of a property that happens to be called `Item`, and written together they
    anchor at one column:

        var x = items[i].Item;

    The oracle row is the indexer on the external receiver. The engine's only site
    there is the property read, correctly resolved to the element type's own
    `get_Item/0`. Name equality paired them and reported `external_wrongly_resolved`
    -- the one bucket the harness treats as unarguable, and a GATE: one occurrence
    fails the run and the corpus verdict.

    The right verdict is that the engine did not see the element access at all.

    CONTROL: a real indexer, one line down, that the engine DID resolve. A fix that
    simply stopped pairing indexer rows would go green on the first assertion and
    red here.
    """
    m = fx.module("mod", "ItemClash.cs")
    fx.method("mProp", "Probe.Element.get_Item", 0)
    fx.method("mIdx", "Probe.Grid.get_this[]", 1)

    # items[i].Item -- the engine has ONLY the member access (the element access on an
    # unstaged receiver emits nothing; that is the engine defect this was hiding).
    e_prop = fx.expression("eProp", m, 15, 70, kind="MEMBER_ACCESS")
    fx.accessor_edge(e_prop, "mProp", "property_read")

    # grid[i] -- a real indexer on an in-source type, resolved.
    e_idx = fx.expression("eIdx", m, 16, 70, kind="ELEMENT_ACCESS")
    fx.accessor_edge(e_idx, "mIdx", "indexer")

    fx.oracle_row("ItemClash.cs", 15, 71, "indexer", "external",
                  "System.Collections.Generic.IReadOnlyList<T>.get_Item/1")
    fx.oracle_row("ItemClash.cs", 16, 71, "indexer", "in_source", "Probe.Grid.get_Item/1")

    r = fx.score()
    s = r["stats"]
    yield "no wrong edge is invented", s.get("external_wrongly_resolved", 0) == 0, s
    yield "the run does not fail", r["_rc"] == 0, r["_rc"]
    yield "the element access reads as unseen", s.get("site_missed", 0) == 1, s
    yield "the real indexer beside it still pairs", s.get("declared_agree", 0) == 1, s


def case_a_real_indexer_is_untouched(fx):
    """
    #1060, the other direction. The guard must only refuse the pairing it was written
    for, and there are three ways to get that wrong.

    1. AN INDEXER READ the engine resolved. The evidence is an `indexer` edge and the
       row must still pair.
    2. AN INDEXER WRITE. `grid[i] = v` carries the same edge kind on the same
       expression kind; a guard keyed on "read" would drop it.
    3. A KEY CARRYING BOTH KINDS of accessor edge. The key cannot tell those apart,
       so the guard stands aside and the pairing is made as before rather than
       refused on the strength of half the evidence.

    Without these, a fix that simply refused every indexer row would pass the case
    above and silently turn a real construct into a coverage hole.
    """
    m = fx.module("mod", "Grid.cs")
    fx.method("mGet", "Probe.Grid.get_this[]", 1)
    fx.method("mSet", "Probe.Grid.set_this[]", 2)
    fx.method("mProp", "Probe.Grid.get_Item", 0)

    e_read = fx.expression("eRead", m, 20, 30, kind="ELEMENT_ACCESS")
    fx.accessor_edge(e_read, "mGet", "indexer")
    e_write = fx.expression("eWrite", m, 21, 30, kind="ELEMENT_ACCESS")
    fx.accessor_edge(e_write, "mSet", "indexer")
    # one key, both kinds of evidence
    e_both_i = fx.expression("eBothI", m, 22, 30, kind="ELEMENT_ACCESS")
    fx.accessor_edge(e_both_i, "mGet", "indexer")
    e_both_p = fx.expression("eBothP", m, 22, 30, kind="MEMBER_ACCESS")
    fx.accessor_edge(e_both_p, "mProp", "property_read")

    fx.oracle_row("Grid.cs", 20, 31, "indexer", "in_source", "Probe.Grid.get_Item/1")
    fx.oracle_row("Grid.cs", 21, 31, "indexer", "in_source", "Probe.Grid.set_Item/2")
    fx.oracle_row("Grid.cs", 22, 31, "indexer", "in_source", "Probe.Grid.get_Item/1")

    r = fx.score()
    s = r["stats"]
    yield "all three indexer rows are seen", s.get("site_seen", 0) == 3, s
    yield "and all three agree", s.get("declared_agree", 0) == 3, s
    yield "none is missed", s.get("site_missed", 0) == 0, s


def case_an_explicit_implementation_is_one_key_on_both_sides(fx):
    """
    #1061. Roslyn puts the interface inside the member's own name, fully qualified
    and with its type arguments:

        declaredKey  Probe.IWorker.Work/1
        runtimeType  Probe.Explicit
        runtimeKey   Probe.Explicit.Probe.IWorker.Work/1

    The engine's key is the parser's qualifiedName plus parameterCount, and the
    parser records the interface in a column of its own, so the qualified name is
    `Probe.Explicit.Work`. The two never met and `norm_key` had no rule for the
    difference, so EVERY explicit implementation counted as a target the engine had
    LOST -- whether or not it had it.

    That matters most at the moment the engine starts producing these targets: the
    score would not move, and the obvious reading of that is "the fix did not work".

    The key builder resolves the written interface name to its QUALIFIED spelling
    from the types the IR declares, which is what the oracle writes; this case is
    what holds it to that, and the next one is why the qualifier is kept at all.

    One site through `IWorker`, two implementing types, and the engine resolves to
    BOTH -- which is what a sound fan is. The ordinary implementation is the control
    in the same set: a change that mangled ordinary keys would lose it and the fan
    would go unsound for the other reason.
    """
    m = fx.module("mod", "Explicit.cs")
    # The interface is DECLARED, which is what lets the key builder resolve the
    # written `IWorker` to the qualified `Probe.IWorker` the oracle spells.
    fx.interface_type("tWorker", "Probe.IWorker")
    fx.method("mIface", "Probe.IWorker.Work", 1)
    fx.method("mExplicit", "Probe.Explicit.Work", 1, explicitInterfaceName="IWorker")
    fx.method("mPlain", "Probe.Implicit.Work", 1)

    e = fx.expression("e1", m, 20, 40)
    fx.call_site(e, "Work")
    fx.candidate(e, "mIface")
    fx.resolves(e, "mExplicit")
    fx.resolves(e, "mPlain")
    fx.classify(e, "client_calls_client")
    fx.oracle_row("Explicit.cs", 20, 41, "invocation", "in_source",
                  "Probe.IWorker.Work/1", targetDispatch="virtual")

    fx.dispatch_row("Probe.IWorker.Work/1", "Probe.Explicit",
                    "Probe.Explicit.Probe.IWorker.Work/1")
    fx.dispatch_row("Probe.IWorker.Work/1", "Probe.Implicit", "Probe.Implicit.Work/1")

    r = fx.score()
    fan = r["fan"]
    yield "the site reaches the fan check", fan.get("sites", 0) == 1, fan
    yield "the fan is sound", fan.get("sound", 0) == 1, fan
    yield "no target reads as lost", fan.get("unsound", 0) == 0, fan
    yield "and nothing extra is claimed", fan.get("exact", 0) == 1, fan


def case_two_explicit_implementations_stay_two_keys(fx):
    """
    #1061, the reason the interface qualifier is KEPT rather than dropped.

    A type may explicitly implement two interfaces that both declare `Work(int)`.
    The parser gives both members the same qualifiedName and the same
    parameterCount, so reducing the oracle side by deleting the qualifier would make
    those two methods ONE key -- and a fan that lost one of them would read as sound
    because its sibling filled the hole.

    Here the engine resolves to the IOther implementation only. The IWorker fan must
    still report a lost target.

    This one is red against the REJECTED ALTERNATIVE rather than against the pre-fix
    code: collapsing the qualifier to nothing, or to a simple name shared by two
    interfaces, makes it report `sound 1, unsound 0` for a fan that lost its only
    target. It is here so the choice cannot be quietly reversed later on the grounds
    that it is the simpler of the two.
    """
    m = fx.module("mod", "Explicit.cs")
    fx.interface_type("tWorker", "Probe.IWorker")
    fx.interface_type("tOther", "Probe.IOther")
    fx.method("mIWorker", "Probe.IWorker.Work", 1)
    fx.method("mExWorker", "Probe.Explicit.Work", 1, explicitInterfaceName="IWorker")
    fx.method("mExOther", "Probe.Explicit.Work", 1, explicitInterfaceName="IOther")

    e = fx.expression("e1", m, 20, 40)
    fx.call_site(e, "Work")
    fx.candidate(e, "mIWorker")
    fx.resolves(e, "mExOther")          # the WRONG one of the two siblings
    fx.classify(e, "client_calls_client")
    fx.oracle_row("Explicit.cs", 20, 41, "invocation", "in_source",
                  "Probe.IWorker.Work/1", targetDispatch="virtual")
    fx.dispatch_row("Probe.IWorker.Work/1", "Probe.Explicit",
                    "Probe.Explicit.Probe.IWorker.Work/1")

    r = fx.score()
    fan = r["fan"]
    yield "the site reaches the fan check", fan.get("sites", 0) == 1, fan
    yield "a sibling does not fill the hole", fan.get("unsound", 0) == 1, fan
    yield "and it is not counted sound", fan.get("sound", 0) == 0, fan


def case_an_operator_site_does_not_block_the_shortcut(fx):
    """
    #1059. A BINARY EXPRESSION ANCHORS AT ITS LEFT OPERAND, so `handler(x) + 1` puts
    the delegate invocation and the operator at ONE column.

    The NAME does not go wrong here; the SINGLE-SITE SHORTCUT does. That shortcut is
    what pairs a position where the parser's calleeName and Roslyn's member name are
    legitimately different words -- for a delegate invoke the parser writes the
    delegate's own name and Roslyn reports `Invoke` -- and it requires the position
    to hold exactly one engine site. A built-in operator site beside the invocation
    makes it two, and the shortcut silently stops applying. The null-conditional
    fallback cannot rescue it either: that one requires the NAME to match, and it
    does not.

    Measured on the run that first emitted operator sites: `site_missed` on the
    held-out set rose from 232 to 238 over a population that had not changed, every
    one a pairing the join stopped making rather than an engine that stopped
    answering. A census of the shapes sharing a column with a new operator site
    found this one: an `invocation` row, DELEGATE_INVOKE and OPERATOR_CALL at the
    position, and the oracle's name among neither.

    THE OPERATOR HERE IS BUILT-IN, which is why the oracle has no row for it and the
    group is still one call. That is the case that bites: a user-defined operator
    would put a second oracle row at the column and the shortcut would be off
    anyway.

    CONTROL: the same position without the operator site must pair as it always did,
    so a fix that simply stopped counting sites would show nothing here.
    """
    m = fx.module("mod", "Chain.cs")
    fx.method("mInvoke", "Probe.Handler.Invoke", 1)

    # `handler(x) + 1` -- the delegate site and the operator site, one column.
    e_del = fx.expression("eDel", m, 12, 30)
    fx.call_site(e_del, "handler", call_kind="DELEGATE_INVOKE")
    fx.candidate(e_del, "mInvoke")
    fx.classify(e_del, "client_calls_client")

    e_op = fx.expression("eOp", m, 12, 30, kind="BINARY")
    fx.call_site(e_op, "op_Addition", call_kind="OPERATOR_CALL")
    fx.classify(e_op, "known_builtin_operator")

    # CONTROL: the same shape one line down, with no operator beside it.
    e_ctl = fx.expression("eCtl", m, 13, 30)
    fx.call_site(e_ctl, "handler", call_kind="DELEGATE_INVOKE")
    fx.candidate(e_ctl, "mInvoke")
    fx.classify(e_ctl, "client_calls_client")

    # Roslyn names the delegate's method `Invoke`; the parser wrote `handler`. Only
    # the shortcut can pair these.
    fx.oracle_row("Chain.cs", 12, 31, "invocation", "in_source", "Probe.Handler.Invoke/1")
    fx.oracle_row("Chain.cs", 13, 31, "invocation", "in_source", "Probe.Handler.Invoke/1")

    r = fx.score()
    s = r["stats"]
    yield "the invocation beside an operator is still seen", s.get("site_seen", 0) == 2, s
    yield "neither is missed", s.get("site_missed", 0) == 0, s
    yield "and both agree", s.get("declared_agree", 0) == 2, s


def case_a_windows_path_joins_a_forward_slash_oracle(fx):
    """
    #1169. The join's first key element is a file path, taken from the IR verbatim on
    one side and from the oracle verbatim on the other. The IR writes the PLATFORM's
    separator; the oracle writes `/` on every platform. Where those differ, only a
    file sitting in the subject's root can ever match, and the scorer reports the
    shortfall AS A RATE -- 4.78% where the truth was 95.84% -- rather than failing.

    The backslash is written literally here, not via os.sep, so the case holds the
    normalisation on every host rather than only on the one that reproduces the bug.
    The two sites are the two halves of the claim: the file in a SUBDIRECTORY is the
    one that was lost, and the file in the ROOT is the one that joined anyway and so
    kept the failure looking like a recall number instead of a broken join.

    #94 is this defect in the Python harness, and the convention it settled --
    normalise the IR's filePath where it is read -- is what this asserts for C#.
    """
    root = fx.module("mod_root", "Program.cs")
    sub = fx.module("mod_sub", "Extensions\\Abbreviations\\Abbreviation.cs")
    fx.method("m1", "N.T.M", 0)
    fx.method("m2", "N.T.N", 0)

    e_root = fx.expression("e_root", root, 3, 10)
    fx.call_site(e_root, "M")
    fx.candidate(e_root, "m1")
    fx.resolves(e_root, "m1")
    fx.classify(e_root, "client_calls_client")
    fx.oracle_row("Program.cs", 3, 11, "invocation", "in_source", "N.T.M/0")

    e_sub = fx.expression("e_sub", sub, 7, 20)
    fx.call_site(e_sub, "N")
    fx.candidate(e_sub, "m2")
    fx.resolves(e_sub, "m2")
    fx.classify(e_sub, "client_calls_client")
    fx.oracle_row("Extensions/Abbreviations/Abbreviation.cs", 7, 21,
                  "invocation", "in_source", "N.T.N/0")

    r = fx.score()
    s = r["stats"]
    yield "the site in a subdirectory is seen", s.get("site_seen", 0) == 2, s
    yield "and agrees", s.get("declared_agree", 0) == 2, s
    # The tell that separates a broken join from a real engine collapse: a collapse
    # leaves rows MISSING, an unjoined path leaves the engine's own site unmatched.
    yield "with no engine site left unmatched", s.get("engine_only_sites", 0) == 0, s


def _join_guard_fixture(fx, ir_prefix):
    """
    Ten files, one call each, all resolved and all correct. `ir_prefix` is prepended to
    the path the IR writes and to nothing else, so the ONLY thing that varies between
    the guard case and its control is whether the two sides' paths agree -- the
    dimension the guard keys on. Ten is above the guard's floor of 8.
    """
    for i in range(10):
        rel = f"F{i}.cs"
        m = fx.module(f"mod{i}", ir_prefix + rel)
        fx.method(f"m{i}", f"N.T{i}.M", 0)
        e = fx.expression(f"e{i}", m, 3, 10)
        fx.call_site(e, "M")
        fx.candidate(e, f"m{i}")
        fx.resolves(e, f"m{i}")
        fx.classify(e, "client_calls_client")
        fx.oracle_row(rel, 3, 11, "invocation", "in_source", f"N.T{i}.M/0")


def case_an_unjoinable_run_fails_instead_of_scoring(fx):
    """
    #1169. The guard, held to the property that matters: a run whose join does not
    stand up must FAIL, not report. Every rate in this scorer is computed over the
    rows that joined, so when the join collapses the rates do not fall -- agreement
    and fan soundness read HIGHER, over a denominator that shrank out of sight. Only
    coverage falls, and it falls to something that reads as an engine collapse.

    The paths here differ by a ROOT rather than by a separator, deliberately: the
    separator can no longer break the join, and the guard is not a second separator
    fix. It is the backstop for the whole class -- any key that cannot match.
    """
    _join_guard_fixture(fx, "src/")

    r = fx.score()
    yield "the run fails", r["_rc"] == 1, r["_rc"]
    yield "and says the join is broken", r.get("join_broken") is True, r.get("join_broken")
    yield "loudly, above the rates", "THE JOIN IS BROKEN" in r["_stdout"], r["_stdout"]


def case_a_healthy_run_of_the_same_shape_does_not_trip_the_guard(fx):
    """
    The control for the case above, and the reason it is worth having: a guard that
    fired on a real run would be worse than the defect it catches, because it would
    fail the runs that ARE measuring. Identical to it in every dimension -- same ten
    files, same sites, same targets -- except the one the guard reads.
    """
    _join_guard_fixture(fx, "")

    r = fx.score()
    s = r["stats"]
    yield "the run passes", r["_rc"] == 0, r["_rc"]
    yield "the guard stays quiet", not r.get("join_broken"), r.get("join_broken")
    yield "nothing is printed about it", "THE JOIN IS BROKEN" not in r["_stdout"], r["_stdout"]
    yield "and all ten sites are scored", s.get("site_seen", 0) == 10, s


CASES = [
    case_unparsable_file_is_not_scored,
    case_binding_errors_are_still_scored,
    case_missing_manifest_says_so,
    case_indexer_row_does_not_pair_with_a_property_named_Item,
    case_a_real_indexer_is_untouched,
    case_an_explicit_implementation_is_one_key_on_both_sides,
    case_two_explicit_implementations_stay_two_keys,
    case_an_operator_site_does_not_block_the_shortcut,
    case_a_windows_path_joins_a_forward_slash_oracle,
    case_an_unjoinable_run_fails_instead_of_scoring,
    case_a_healthy_run_of_the_same_shape_does_not_trip_the_guard,
]


def main():
    verbose = "-v" in sys.argv
    passed = failed = 0
    for case in CASES:
        with tempfile.TemporaryDirectory(prefix="cs-score-selftest-") as tmp:
            fx = Fixture(tmp)
            title = case.__name__.replace("case_", "").replace("_", " ")
            # Drained one check at a time, so a later check that RAISES (a stat the
            # scorer does not emit yet) does not discard the earlier ones. Run against
            # the pre-fix scorer this file first reported only a KeyError, which hid
            # the substantive disagreement underneath it -- and a red test whose
            # reason is wrong is only marginally better than a green one.
            checks, gen = [], case(fx)
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
                if verbose:
                    print(f"  ✓ {title}  ({len(checks)} checks)")
                else:
                    print(f"  ✓ {title}")

    print(f"\nscore.py self-test: {passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
