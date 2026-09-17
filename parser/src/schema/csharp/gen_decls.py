#!/usr/bin/env python3
"""Generate decls_base_cs.dl FROM CSHARP-FACT-SCHEMA.md's own column lists.

Run with --check to diff instead of write (for CI). Exit 0 clean, 1 on drift.

WHY THIS READS THE MARKDOWN AND NOT A schema.json
=================================================
Python, TypeScript and JavaScript each generate their `.dl` from a `schema.json`
that sits beside it. C# does not have one, and adding one would create a SECOND
SOURCE OF TRUTH for a schema that is already frozen: the ruling document is
`CSHARP-FACT-SCHEMA.md`, every column list in it is numbered and ordered, and
`src/test/csharp-gates/schema-arity-selfcheck.py` already parses it to prove
each heading agrees with its own list. A transcription step between the ruling
and the generator is a place for the two to disagree, and nothing would be
watching the transcription.

So the frozen document IS the machine-readable schema here. The parser below is
deliberately the same shape as the arity self-check's, and the two are run
together by the release gate: the self-check proves the document is internally
consistent, this proves the `.dl` matches it, and `arity contract` in
csharp-tests.ts proves the EMITTED headers match it too. Three links, one chain:
document -> engine declarations -> emitted rows.

WHAT THE .dl IS
===============
The contract with the Souffle engine. It carries only `c0..cN`, so a column
RENAME is free after the freeze and a REORDER is not — which is exactly why the
file is generated rather than hand-maintained. A hand-edited `.dl` drifts
silently, and a shifted column loads into Souffle without error.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DOC = os.path.join(HERE, 'CSHARP-FACT-SCHEMA.md')
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
//     DYNAMIC_CALL, CONVERSION_CALL, OPERATOR_CALL, ELEMENT_ACCESS_CALL and
//     INSTANCE_METHOD_GROUP among them. Each is a fact syntax cannot decide — an
//     implicit user-defined conversion runs with no syntax at the call site at all —
//     and the parser emitting nothing there is the reservation working. Do not read
//     their absence as coverage.
//
//  5. cs_parse_gap IS PART OF THE ANSWER. Where the grammar could not read the
//     source, a row says so, with a byte fraction. A consumer that joins the other
//     relations and ignores this one is reading a fact base with holes it has been
//     told about.
// ============================================================================

"""

TRAILER = ['isExternal', 'serviceVersionLinkHash']


def relations(text):
    """Every relation's ordered column list, from the document's own lists.

    A heading is `### N.N \\`cs_x\\` — K columns`, optionally followed by a star,
    and the list is the first fenced block after it. The LIST is authoritative:
    only a list states an ORDER, and the arity self-check already refuses a
    document whose heading and list disagree.
    """
    out = []
    pattern = re.compile(
        r'^###\s+[0-9.]+\s+`(cs_[a-z_]+)`\s+—\s+(\d+)\s+columns',
        re.M,
    )
    for match in pattern.finditer(text):
        name = match.group(1)
        declared = int(match.group(2))
        fence = text.find('```', match.end())
        if fence == -1:
            raise SystemExit(f'{name}: heading with no column list')
        close = text.find('```', fence + 3)
        body = text[fence + 3:close]
        columns = [c.strip() for c in body.replace('\n', ' ').split(',')]
        columns = [c for c in columns if c]
        out.append((name, declared, columns))
    return out


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
        text = f.read()
    rels = relations(text)
    if not rels:
        raise SystemExit('no relations found in CSHARP-FACT-SCHEMA.md')

    problems = []
    for name, declared, columns in rels:
        if declared != len(columns):
            problems.append(
                f'{name}: heading says {declared} columns, its list has {len(columns)}'
            )
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
        # schema` check reads this instead of parsing the document a second
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
            print(f'DRIFT {os.path.basename(OUT)} differs from the schema document.')
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
        print(f'{len(rels)} relations checked; {os.path.basename(OUT)} matches the schema document')
        return 0

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(generated)
    print(f'wrote {os.path.basename(OUT)}: {len(rels)} relations, '
          f'{sum(len(c) for _, _, c in rels)} columns')
    return 0


if __name__ == '__main__':
    sys.exit(main())
