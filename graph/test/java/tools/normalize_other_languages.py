#!/usr/bin/env python3
"""The other-languages golden: every JavaScript and TypeScript file the parser took as source in a Java case, and
every directory its JavaScript walk pruned.

The Java goldens say nothing about the other analyzers the same parse runs, so a Maven project whose generated
javadoc (target/site/apidocs/script.js) was extracted as a JavaScript project, and given a graph of its own, moved
no Java golden at all (#1545). One line per module (`<lang>\tmodule\t<path>`) and one per pruned directory
(`javascript\tpruned\t<path>\t<detail>`), repo-relative, sorted; nothing when the case has neither.

usage: normalize_other_languages.py <IR-dir>
"""
import csv, os, sys

csv.field_size_limit(1 << 30)


def rows(path):
    if not os.path.isfile(path) or os.path.getsize(path) == 0:   # a relation with no rows is a zero-byte file (#244)
        return []
    with open(path, newline='') as fh:
        return list(csv.DictReader(fh, delimiter='\t'))


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: normalize_other_languages.py <ir>")
    ir = sys.argv[1]
    out = []
    for lang, name in (('javascript', 'all-javascript-modules.csv'), ('typescript', 'all-typescript-modules.csv')):
        out += [f"{lang}\tmodule\t{r['filePath']}" for r in rows(os.path.join(ir, name))]
    out += [f"javascript\tpruned\t{r['filePath']}\t{r['detail']}"
            for r in rows(os.path.join(ir, 'skipped-javascript-files.csv')) if r.get('reason') == 'DIRECTORY_EXCLUDED']
    if out:
        print('\n'.join(sorted(out)))


if __name__ == '__main__':
    main()
