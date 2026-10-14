#!/usr/bin/env python3
"""One text file per case: a case's site (often a page, a stylesheet and a partial) is a single file to read and to
review, and the suite is ~130 files instead of ~470.

    <suite>/<case>.case     the case.conf lines first, then each file of the case's tree:
                              @@@ file: src/index.html
                              <its bytes, exactly>
                            a header ending in ` noeol` drops the newline before the next header (the file has no
                            final newline); one ending in ` base64` holds the bytes base64-encoded (binary assets,
                            CR line ends, anything not UTF-8, or a line that would read as a header)
    queries/<case>.answers  the same format for a query case's expected answers (one <qid>.tsv each)

    cases.py unpack <file.case|file.answers|dir> <dest>   a file -> <dest>/; a directory of <suite>/<case>.case ->
                                                         <dest>/<suite>/<case>/ (case.conf + src/ ...)
    cases.py pack <dir> <file> [--conf]                  the reverse; --conf puts <dir>/case.conf first
    cases.py check <dir> <file> [--conf]                 exit 1 unless <file> unpacks to exactly <dir>
"""
import base64
import os
import re
import sys

HEAD = '@@@ file: '


def _text(data):
    try:
        s = data.decode('utf-8')
    except UnicodeDecodeError:
        return None
    if '\r' in s or any(line.startswith(HEAD) for line in s.split('\n')):
        return None
    return s


def pack(root, conf=False):
    out = []
    if conf:
        with open(os.path.join(root, 'case.conf'), encoding='utf-8') as f:
            c = f.read()
        if HEAD in c or not c.endswith('\n'):
            raise SystemExit(f'{root}/case.conf: must end with a newline and hold no "{HEAD}" line')
        out.append(c)
    files = []
    for d, dirs, names in os.walk(root):
        dirs.sort()
        for n in sorted(names):
            rel = os.path.relpath(os.path.join(d, n), root).replace(os.sep, '/')
            if not (conf and rel == 'case.conf'):
                files.append(rel)
    for rel in sorted(files):
        if ' ' in rel or '\n' in rel:
            raise SystemExit(f'{root}/{rel}: a file name with a space or newline cannot be packed')
        with open(os.path.join(root, rel), 'rb') as f:
            data = f.read()
        s = _text(data)
        if s is None:
            out.append(f'{HEAD}{rel} base64\n{base64.encodebytes(data).decode("ascii")}')
        elif s == '' or s.endswith('\n'):
            out.append(f'{HEAD}{rel}\n{s}')
        else:
            out.append(f'{HEAD}{rel} noeol\n{s}\n')
    return ''.join(out)


def unpack_text(text, dest):
    # a header is a line that starts with HEAD; a file's bytes are exactly what lies between its header line and the
    # next header (pack ends every body with a newline, or leaves it empty)
    starts = [m.start() for m in re.finditer('^' + re.escape(HEAD), text, re.M)]
    os.makedirs(dest, exist_ok=True)
    conf = text[:starts[0]] if starts else text
    if conf:
        with open(os.path.join(dest, 'case.conf'), 'w', encoding='utf-8', newline='') as f:
            f.write(conf)
    for i, s in enumerate(starts):
        eol = text.index('\n', s)
        name, _, flag = text[s + len(HEAD):eol].partition(' ')
        body = text[eol + 1:starts[i + 1] if i + 1 < len(starts) else len(text)]
        if flag == 'base64':
            data = base64.decodebytes(body.encode('ascii'))
        elif flag == 'noeol':
            data = body[:-1].encode('utf-8')
        elif flag == '':
            data = body.encode('utf-8')
        else:
            raise SystemExit(f'unknown flag "{flag}" on {name}')
        path = os.path.join(dest, *name.split('/'))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(data)


def unpack_file(path, dest):
    with open(path, encoding='utf-8', newline='') as f:
        unpack_text(f.read(), dest)


def snapshot(root):
    got = {}
    for d, _, names in os.walk(root):
        for n in names:
            p = os.path.join(d, n)
            with open(p, 'rb') as f:
                got[os.path.relpath(p, root).replace(os.sep, '/')] = f.read()
    return got


def main(argv):
    if len(argv) < 3:
        print(__doc__); return 2
    cmd, a, b = argv[0], argv[1], argv[2]
    conf = '--conf' in argv[3:]
    if cmd == 'unpack':
        if os.path.isdir(a):
            for suite in sorted(os.listdir(a)):
                sd = os.path.join(a, suite)
                if not os.path.isdir(sd):
                    continue
                for n in sorted(os.listdir(sd)):
                    if n.endswith('.case'):
                        unpack_file(os.path.join(sd, n), os.path.join(b, suite, n[:-len('.case')]))
        else:
            unpack_file(a, b)
        return 0
    if cmd == 'pack':
        with open(b, 'w', encoding='utf-8', newline='') as f:
            f.write(pack(a, conf))
        return 0
    if cmd == 'check':
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            unpack_file(b, t)
            if snapshot(t) != snapshot(a):
                print(f'{b} does not unpack to {a}'); return 1
        return 0
    print(__doc__); return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
