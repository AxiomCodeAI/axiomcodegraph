#!/usr/bin/env python3
"""Generate decls_base_cs.dl FROM schema.json's own column lists.

Run with --check to diff instead of write (for CI). Exit 0 clean, 1 on drift.

WHERE THE SCHEMA LIVES
======================
`schema.json`, beside this file, exactly as python, typescript and javascript
each keep theirs. It was generated once from the retired `CSHARP-FACT-SCHEMA.md`
and is now edited HERE: one machine-readable file per language, no prose
document to transcribe from and no second source of truth.

The invariants the retired document's self-check carried come with it, and are
asserted below on every run: no relation repeats a column name, and every
relation ends in `isExternal, serviceVersionLinkHash, <its own hash>`. What is
gone with the prose is the prose — the rulings, their reasons and the version
ledger, which are history and belong in the git log, not in a file the
generator has to parse.

Two links, one chain: `--check` proves the `.dl` matches this schema, and
`arity contract` in csharp-tests.ts proves the EMITTED headers match it too,
reading the columns from `--columns` so the schema keeps ONE parser.

WHAT THE .dl IS
===============
The contract with the Souffle engine. It carries only `c0..cN`, so a column
RENAME is free after the freeze and a REORDER is not — which is exactly why the
file is generated rather than hand-maintained. A hand-edited `.dl` drifts
silently, and a shifted column loads into Souffle without error.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DOC = os.path.join(HERE, 'schema.json')
OUT = os.path.join(HERE, 'decls_base_cs.dl')

#: What an engine author has to know before joining anything C#. Kept HERE
#: rather than in the schema document because the `.dl` is the first file such a
#: reader opens, and it must stand alone. Each of these is a fact about the
#: LANGUAGE that makes a rule written for Java wrong.
PREAMBLE = """// ============================================================================
// Base input relations — C# parser IR. One relation pair per entity kind.
//
// GENERATED FROM CSHARP-FACT-SCHEMA.md BY gen_decls.py — DO NOT HAND-EDIT.
// Re-run `python3 gen_decls.py --check` in CI; drift here is a silent schema break.
//
// NAMING: one prefix per core language; `lib_` is the EXTERNAL marker on top of it.
// The distinction is PROVENANCE, not language: the project under analysis vs
// everything else.
//
//     cs_<entity>       C# under analysis            <- the PARSER emits only these
//     lib_cs_<entity>   external / third-party       <- the ENGINE stages these
//
// COLUMN ORDER IS THE CONTRACT. All columns are `symbol`. New columns append ONLY.
// The last column is always the entity's own unique hash; serviceVersionLinkHash is
// immediately before it, and `isExternal` before that. Column NAMES live only in the
// schema document, so a rename is free after the freeze and a reorder is not.
//
// FIVE THINGS AN ENGINE AUTHOR MUST READ BEFORE JOINING ANYTHING:
//
//  1. `name -> single entity` IS FALSE. A `partial` type is ONE type declared in N
//     files, and `partial` methods split a declaration from its implementation.
//     cs_type/cs_method are keyed PER DECLARATION SITE; the merged entity is
//     `declarationGroupKey`, which is deliberately NOT UNIQUE. Group on it. A rule
//     that assumes one row per name is wrong by construction.
//
//  2. GENERICS ARE REIFIED, not erased. `List<int>` and `List<string>` are distinct
//     runtime types, so arity and type arguments are part of identity in a way a
//     Java-shaped rule does not expect. Nothing here encodes erasure.
//
//  3. `grammarRegime` in cs_module is COARSE and IN THE KEY. It names the parse
//     mechanism, not a version: a patch bump must not rewrite every hash. A row
//     whose regime differs describes a different program-reading.
//
//  4. SEVERAL KINDS ARE RESERVED WITH ZERO ROWS, by ruling rather than by omission:
//     DYNAMIC_CALL, ELEMENT_ACCESS_CALL and INSTANCE_METHOD_GROUP among them. Each
//     is a fact syntax cannot decide, and the parser emitting nothing there is the
//     reservation working. Do not read their absence as coverage.
//
//     OPERATOR_CALL AND CONVERSION_CALL ARE NOT AMONG THEM ANY MORE. They were, on
//     the implicit conversion's reasoning — that one runs with no syntax at the
//     call site at all, and it is still reserved. That reasoning does not transfer
//     to `a + b`, `a == b` or `(T)x`, which are written down. What syntax cannot
//     decide there is WHICH method runs, and that is resolution, exactly as a
//     receiver's type is for an ordinary invocation. A site is emitted for every
//     such expression outside a constant-expression context, and the engine
//     decides; where no user-defined operator exists it is classified
//     known_builtin_operator, which is the truthful answer, not a blind spot.
//
//  5. cs_parse_gap IS PART OF THE ANSWER. Where the grammar could not read the
//     source, a row says so, with a byte fraction. A consumer that joins the other
//     relations and ignores this one is reading a fact base with holes it has been
//     told about.
// ============================================================================

"""

TRAILER = ['isExternal', 'serviceVersionLinkHash']


def relations(doc):
    """Every relation's ordered column list, in the order the schema declares.

    The LIST is the contract: only a list states an ORDER, and column order is
    what the Souffle engine joins on.
    """
    return [(name, len(entry['columns']), list(entry['columns']))
            for name, entry in doc['relations'].items()]


def dl_text(rels):
    lines = [PREAMBLE]
    for name, _declared, columns in rels:
        arity = len(columns)
        cols = ','.join(f'c{i}:symbol' for i in range(arity))
        # The column NAMES as a comment: the .dl cannot carry them, and an
        # engine author reading c17 needs somewhere to look that is not a
        # different repository.
        lines.append(f'// {name}: ' + ', '.join(
            f'c{i} {c}' for i, c in enumerate(columns)
        ))
        lines.append(f'.decl {name}({cols})')
        lines.append(f'.decl lib_{name}({cols})')
        lines.append(f'.input {name}')
        lines.append(f'.input lib_{name}')
        lines.append('')
    return '\n'.join(lines)


def main():
    with open(DOC, encoding='utf-8') as f:
        doc = json.load(f)
    rels = relations(doc)
    if not rels:
        raise SystemExit('no relations found in schema.json')

    problems = []
    for name, _declared, columns in rels:
        # FROM THE RETIRED SELF-CHECK. A repeated column name is a schema that
        # cannot say which position a consumer means, and it read as a valid
        # arity from every side.
        seen = [c for i, c in enumerate(columns) if c in columns[:i]]
        if seen:
            problems.append(f'{name}: repeats the column name(s) {sorted(set(seen))}')
        if columns[-len(TRAILER):] != TRAILER + [] and columns[-3:-1] != TRAILER:
            # The trailer convention: ... isExternal, serviceVersionLinkHash, <ownHash>
            problems.append(
                f'{name}: does not end in {TRAILER} + its own hash — ends in {columns[-3:]}'
            )
    if problems:
        for p in problems:
            print('DRIFT ' + p)
        return 1

    if '--columns' in sys.argv:
        # ONE PARSER, TWO CONSUMERS. The suite's `emitted headers match the
        # schema` check reads this instead of parsing schema.json a second
        # time in TypeScript: a schema with two parsers has two schemas, and
        # the day they disagree neither is the contract.
        for name, _declared, columns in rels:
            print(name + '\t' + ','.join(columns))
        return 0

    generated = dl_text(rels)
    if '--check' in sys.argv:
        if not os.path.exists(OUT):
            print(f'MISSING {OUT} — run gen_decls.py to create it')
            return 1
        with open(OUT, encoding='utf-8') as f:
            current = f.read()
        if current != generated:
            print(f'DRIFT {os.path.basename(OUT)} differs from schema.json.')
            print('Re-run `python3 gen_decls.py` and commit the result.')
            cur = current.splitlines()
            new = generated.splitlines()
            for i in range(max(len(cur), len(new))):
                a = cur[i] if i < len(cur) else '<absent>'
                b = new[i] if i < len(new) else '<absent>'
                if a != b:
                    print(f'  line {i + 1}:\n    file:   {a[:160]}\n    schema: {b[:160]}')
                    break
            return 1
        print(f'{len(rels)} relations checked; {os.path.basename(OUT)} matches schema.json')
        return 0

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(generated)
    print(f'wrote {os.path.basename(OUT)}: {len(rels)} relations, '
          f'{sum(len(c) for _, _, c in rels)} columns')
    return 0


if __name__ == '__main__':
    sys.exit(main())
