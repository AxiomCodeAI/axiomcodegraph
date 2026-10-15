#!/usr/bin/env python3
"""tests/index_reader.py: axiomcode-index reads the IR exactly as csv.DictReader did, row for row and key for key.

axiomcode-index reads every IR row through ir_rows(), a line splitter that replaced
csv.DictReader(f, delimiter='\\t', quoting=csv.QUOTE_NONE) because the DictReader was most of the index's time on a
large repository. The index's tables are made of these dicts, so any difference is a different graph. Each fixture is
read by both and the lists of dicts must be equal: the shapes where a line splitter and the csv module could part
are a quoted field holding a tab or a newline (QUOTE_NONE does not unquote, so both split it), CRLF, a lone CR, a
blank line, a short row (None for the missing columns), a long row (the rest under the key None), a repeated header
name, a blank header, an empty file, a header with no rows, no final newline, bytes that are not UTF-8, and the
Unicode line separators that str.splitlines() would split on and the csv module does not.

    python3 tests/index_reader.py [IR_DIR ...]     each IR_DIR: every *.csv in it is compared as well
"""
import ast, csv, glob, itertools, os, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode-index')
csv.field_size_limit(10**9)
MISSING = object()


def load_ir_rows():
    """ir_rows() out of the script without running it (the script indexes a graph at import)."""
    tree = ast.parse(open(SCRIPT, encoding='utf-8').read())
    fn = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'ir_rows']
    if not fn:
        sys.exit('FAIL: axiomcode-index defines no ir_rows()')
    ns = {}
    exec(compile(ast.Module(body=fn, type_ignores=[]), SCRIPT, 'exec'), ns)
    return ns['ir_rows']


def dictreader(p):
    with open(p, newline='', encoding='utf-8', errors='replace') as f:
        return list(csv.DictReader(f, delimiter='\t', quoting=csv.QUOTE_NONE))


FIXTURES = {
    'plain': b'a\tb\tc\n1\t2\t3\n4\t5\t6\n',
    'quoted-tab': b'a\tb\tc\n"x\ty"\t2\t3\n1\t"p\tq"\t3\n',
    'quoted-newline': b'a\tb\tc\n"line one\nline two"\t2\t3\n4\t5\t6\n',
    'quoted-crlf-inside': b'a\tb\n"x\r\ny"\tz\n',
    'doubled-quotes': b'a\tb\n"@r.post(""/orders"")"\t1\n"""Fee"""\t2\n',
    'crlf': b'a\tb\tc\r\n1\t2\t3\r\n4\t5\t6\r\n',
    'lone-cr': b'a\tb\r1\t2\r3\t4\r',
    'mixed-endings': b'a\tb\n1\t2\r\n3\t4\r5\t6\n',
    'blank-lines': b'a\tb\n\n1\t2\n\r\n\n3\t4\n\n',
    'short-row': b'a\tb\tc\n1\t2\n1\n',
    'long-row': b'a\tb\n1\t2\t3\t4\n',
    'trailing-tab': b'a\tb\n1\t\n\t\n',
    'repeated-header': b'id\tname\tid\n1\tx\t2\n3\n',
    'blank-header': b'\n1\t2\n3\n',
    'empty': b'',
    'header-only': b'a\tb\n',
    'header-only-no-newline': b'a\tb',
    'no-final-newline': b'a\tb\n1\t2\n3\t4',
    'not-utf8': b'a\tb\n\xff\xfe\t\xc3\x28\n',
    'unicode-separators': 'a\tb\nx y\tz\u0085w\n1\u000b2\t3\u000c4\n'.encode('utf-8'),
    'spaces': b'a\tb\n  1 \t 2  \n',
}


def main(argv):
    ir_rows = load_ir_rows()
    fails = checks = 0
    rows_compared = 0
    with tempfile.TemporaryDirectory() as w:
        for name, data in FIXTURES.items():
            p = os.path.join(w, name + '.csv')
            open(p, 'wb').write(data)
            want, got = dictreader(p), list(ir_rows(p))
            checks += 1; rows_compared += len(want)
            if want != got:
                fails += 1
                print(f'FAIL {name}: csv.DictReader {want!r}\n     ir_rows         {got!r}')
        # not vacuous: the fixtures hold rows, and the shapes the reader special-cases are among them
        p = os.path.join(w, 'short-row.csv')
        checks += 1
        if list(ir_rows(p)) != [{'a': '1', 'b': '2', 'c': None}, {'a': '1', 'b': None, 'c': None}]:
            fails += 1; print(f'FAIL short-row: {list(ir_rows(p))!r}')
        p = os.path.join(w, 'long-row.csv')
        checks += 1
        if list(ir_rows(p)) != [{'a': '1', 'b': '2', None: ['3', '4']}]:
            fails += 1; print(f'FAIL long-row: {list(ir_rows(p))!r}')
    # a real IR: every file of every directory named on the command line
    files = 0
    for d in argv:
        for p in sorted(glob.glob(os.path.join(d, '*.csv'))):
            files += 1; checks += 1
            n = 0
            with open(p, newline='', encoding='utf-8', errors='replace') as f:   # streamed: an IR file can be 10^6 rows
                for a, b in itertools.zip_longest(csv.DictReader(f, delimiter='\t', quoting=csv.QUOTE_NONE), ir_rows(p), fillvalue=MISSING):
                    n += 1
                    if a != b:
                        fails += 1; print(f'FAIL {p} row {n}: csv.DictReader {a!r}\n     ir_rows {b!r}'); break
            rows_compared += n
    if rows_compared < 20:
        fails += 1; print(f'FAIL only {rows_compared} rows compared')
    print(f"index_reader: {'ok' if not fails else 'FAILED'} ({checks - fails}/{checks} checks, {rows_compared} rows,"
          f" {len(FIXTURES)} fixtures{f', {files} IR files' if files else ''})")
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
