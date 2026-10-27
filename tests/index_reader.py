#!/usr/bin/env python3
"""tests/index_reader.py: axiomcode-index reads the IR as the bundle does, row for row and key for key.

axiomcode-index reads every IR row through ir_rows(), a line splitter that replaced csv.DictReader because the
DictReader was most of the index's time on a large repository. The index's tables are made of these dicts, so any
difference is a different graph. The parser writes RFC 4180 over a tab (EntityUtils.escapeTsv quotes a field that
holds a `"` and doubles the quote), and ir_rows decodes it: read QUOTE_NONE, as it once was, the literal
`Order "Foo"` was stored `Order ""Foo""` and `impact` said no literal held it (#1835).

Each fixture is read three ways, and they must agree:
  - csv.DictReader(f, delimiter='\\t') over open(p, newline=''), RFC 4180 quoting on: the same list of dicts;
  - the bundle's own reader, graph/bundle/csv.ts readRfc4180 (the built dist/bundle/csv.js, run with node): its rows,
    zipped with the header, must give the same dicts. A lone CR is left out of this half on purpose: ir_rows keeps
    the csv module's rule that it ends a line, and the bundle splits on \\n only. A blank line is no row in either
    (the bundle yields one empty field for it, which is dropped here);
  - for the shapes the bug was about, the decoded value itself, written out, so two readers agreeing on a wrong value
    is not a pass: a literal with quotes, a decoration with a quoted path, a C# raw string `\"\"\"x\"\"\"`, a C#
    member access on a string (`"x".Length`), a quote inside a field, and the control, a field with no quote.
The other shapes are where a line splitter and the csv module could part: a quoted field holding a tab or a newline,
CRLF, a lone CR, a blank line, a short row (None for the missing columns), a long row (the rest under the key None),
a repeated header name, a blank header, an empty file, a header with no rows, no final newline, bytes that are not
UTF-8, and the Unicode line separators that str.splitlines() would split on and the csv module does not.

    python3 tests/index_reader.py [IR_DIR ...]     each IR_DIR: every *.csv in it is compared with csv.DictReader too
"""
import ast, csv, glob, itertools, json, os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode-index')
BUNDLE_CSV = os.path.join(ROOT, 'dist', 'bundle', 'csv.js')      # graph/bundle/csv.ts, built
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
        return list(csv.DictReader(f, delimiter='\t'))


BUNDLE_JS = r'''
const { readRfc4180 } = require(process.argv[1]);
(async () => {
  const out = {};
  for (const p of process.argv.slice(2)) { out[p] = []; for await (const r of readRfc4180(p)) out[p].push(r); }
  process.stdout.write(JSON.stringify(out));
})();
'''


def bundle_rows(paths):
    """{path: the bundle reader's rows}, or None when node or the built reader is not there."""
    node = shutil.which('node')
    if not node or not os.path.exists(BUNDLE_CSV):
        return None
    r = subprocess.run([node, '-e', BUNDLE_JS, BUNDLE_CSV] + paths, capture_output=True, text=True, encoding='utf-8')
    if r.returncode:
        sys.exit(f'FAIL: the bundle reader did not run: {r.stderr[-400:]}')
    return json.loads(r.stdout)


def as_dicts(rows):
    """The bundle's rows as ir_rows' dicts: the first row is the header, a blank line (one empty field) is no row."""
    if not rows:
        return []
    keys = rows[0] if rows[0] != [''] else []
    n, out = len(keys), []
    for v in rows[1:]:
        if v == ['']:
            continue
        d = dict(zip(keys, v))
        if len(v) > n:
            d[None] = v[n:]
        for k in keys[len(v):]:
            d[k] = None
        out.append(d)
    return out


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
    'unicode-separators': 'a\tb\nx y\tz\u0085w\n1\u000b2\t3\u000c4\n'.encode('utf-8'),
    'spaces': b'a\tb\n  1 \t 2  \n',
    # the quoting EntityUtils.escapeTsv writes, as the parser wrote it for each shape
    'quoted-literal': b'value\tkind\n"Order ""Foo"" Is Late"\tstring\n',
    'quoted-decoration': b'name\ttext\nRequestMapping\t"@RequestMapping(""/a/{b}"")"\nRequestMapping\t"""/a/{b}"""\n',
    'csharp-raw-string': b'value\tkind\n"""""""x"""""""\tstring\n',
    'csharp-string-member': b'name\tkind\n"""x"".Length"\tMEMBER_ACCESS\n',
    'plain-control': b'value\tkind\nThe order has shipped\tstring\n',
    # what RFC 4180 says about a quote that does not open a field, and about text after the closing quote
    'quote-inside-field': b'a\tb\tc\nsay "hi"\tx"\ty"z"\n',
    'text-after-close': b'a\tb\n"ab"cd\t"x""y"z\n',
    'empty-quoted': b'a\tb\tc\n""\t""""\t\n',
    'quoted-crlf-row': b'a\tb\r\n"x ""y"""\t2\r\n',
    'quoted-header': b'"a"\t"b ""c"""\n1\t2\n',
    'quoted-open-at-eof': b'a\tb\n"x\ty\n',
}

# the decoded values, written out
DECODED = {
    'quoted-literal': [{'value': 'Order "Foo" Is Late', 'kind': 'string'}],
    'quoted-decoration': [{'name': 'RequestMapping', 'text': '@RequestMapping("/a/{b}")'},
                          {'name': 'RequestMapping', 'text': '"/a/{b}"'}],
    'csharp-raw-string': [{'value': '"""x"""', 'kind': 'string'}],
    'csharp-string-member': [{'name': '"x".Length', 'kind': 'MEMBER_ACCESS'}],
    'plain-control': [{'value': 'The order has shipped', 'kind': 'string'}],
    'quote-inside-field': [{'a': 'say "hi"', 'b': 'x"', 'c': 'y"z"'}],
    'quoted-open-at-eof': [{'a': 'x\ty\n', 'b': None}],
    'text-after-close': [{'a': 'abcd', 'b': 'x"yz'}],
    'quoted-header': [{'a': '1', 'b "c"': '2'}],
}
# a lone CR ends an ir_rows line and is text to the bundle's reader (the parser never writes one: escapeTsv escapes it)
NOT_BUNDLE = {'lone-cr', 'mixed-endings'}


def main(argv):
    ir_rows = load_ir_rows()
    fails = checks = 0
    rows_compared = bundle_checked = 0
    with tempfile.TemporaryDirectory() as w:
        paths = {}
        for name, data in FIXTURES.items():
            p = paths[name] = os.path.join(w, name + '.csv')
            open(p, 'wb').write(data)
        bundle = bundle_rows(list(paths.values()))
        for name, p in paths.items():
            want, got = dictreader(p), list(ir_rows(p))
            checks += 1; rows_compared += len(want)
            if want != got:
                fails += 1
                print(f'FAIL {name}: csv.DictReader {want!r}\n     ir_rows         {got!r}')
            if name in DECODED:
                checks += 1
                if got != DECODED[name]:
                    fails += 1; print(f'FAIL {name}: decoded {got!r}\n     want    {DECODED[name]!r}')
            if bundle is not None and name not in NOT_BUNDLE:
                checks += 1; bundle_checked += 1
                b = as_dicts(bundle[p])
                if b != got:
                    fails += 1; print(f'FAIL {name}: bundle readRfc4180 {b!r}\n     ir_rows          {got!r}')
        # not vacuous: the fixtures hold rows, and the shapes the reader special-cases are among them
        p = paths['short-row']
        checks += 1
        if list(ir_rows(p)) != [{'a': '1', 'b': '2', 'c': None}, {'a': '1', 'b': None, 'c': None}]:
            fails += 1; print(f'FAIL short-row: {list(ir_rows(p))!r}')
        p = paths['long-row']
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
                for a, b in itertools.zip_longest(csv.DictReader(f, delimiter='\t'), ir_rows(p), fillvalue=MISSING):
                    n += 1
                    if a != b:
                        fails += 1; print(f'FAIL {p} row {n}: csv.DictReader {a!r}\n     ir_rows {b!r}'); break
            rows_compared += n
    if rows_compared < 20:
        fails += 1; print(f'FAIL only {rows_compared} rows compared')
    if bundle is None:
        print('index_reader: the bundle half was NOT run (no node on PATH, or dist/bundle/csv.js is not built)')
    elif bundle_checked < len(FIXTURES) - len(NOT_BUNDLE):
        fails += 1; print(f'FAIL the bundle reader was compared on only {bundle_checked} fixtures')
    print(f"index_reader: {'ok' if not fails else 'FAILED'} ({checks - fails}/{checks} checks, {rows_compared} rows,"
          f" {len(FIXTURES)} fixtures, {bundle_checked} against the bundle reader{f', {files} IR files' if files else ''})")
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
