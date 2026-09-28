"""[text]: what a search by hand finds, for a question the graph has no declaration for.

NEVER ANSWER WORSE THAN GREP. A name no graph declares (a message, an environment variable, a key written in a YAML, a
string an issue quotes) was refused with "nothing named X" and nothing else, and the agent asked it then searched the
tree by hand: most of the searches that bypassed the graph were exactly that. The search is cheap and the tool knows
more than grep does about each line it finds: which declaration holds it, or that no graph reads that file at all.

So a refusal now carries the text matches, and every one of them is labelled `[text]`: a line that WRITES the name,
never a call edge, never counted as a caller, and never an exit status of 0 (the verb still refused). The containing
declaration is looked up in every graph of the repository, so a line in another language's file is placed too.

In a repository in several languages every graph refuses on its own (ax_langs.py). A verb that is one of several
(AXIOMCODE_FANOUT) prints no text block: it writes MARK and what it would have searched for on stderr, and the
dispatcher prints ONE block when no graph answered, instead of the same lines once per language.
"""
import json, os, re, subprocess, sys

MARK = 'axiomcode-text: '
SCOPE_GONE = 'scope: no indexed file in any graph has '    # the line that says an --in was dropped for the root
ROWS = 12                    # rows printed; the count of the rest is printed with them
PER_FILE = 3                 # rows from one file before the next file gets a turn
_FILE_LIKE = re.compile(r'^[\w./-]*\.[A-Za-z][\w]{0,7}$|/')
_FILE_LINE = re.compile(r':\d+(:\d+)?$')


def graph_dbs(repo):
    """every graph.sqlite of the repository, the main one first"""
    import ax_langs
    return [os.path.join(d or os.path.join(repo, '.axiomcode'), 'out', 'graph.sqlite') for _, d in ax_langs.graphs(repo)]


def _con(db):
    import sqlite3
    try: return sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    except Exception: return None


def held(repo, scope):
    """True when some graph of the repository holds a file with `scope` in its path"""
    for db in graph_dbs(repo):
        c = _con(db)
        if not c: continue
        try:
            if c.execute("SELECT 1 FROM symbols WHERE file LIKE ? LIMIT 1", (f'%{scope}%',)).fetchone(): return True
        except Exception: pass
        finally: c.close()
    return False


def declared(repo, name):
    """True when some graph declares a symbol named `name`"""
    for db in graph_dbs(repo):
        c = _con(db)
        if not c: continue
        try:
            if c.execute("SELECT 1 FROM symbols WHERE name = ? LIMIT 1", (name,)).fetchone(): return True
        except Exception: pass
        finally: c.close()
    return False


def needles(asked):
    """[(needle, whole word?)] to try in turn for a name as it was asked: the whole of it, then (for Owner.member) the
    member alone. A quoted string is searched as written; a file:line is not searched (the graph answers a line)"""
    s = asked.strip()
    if len(s) > 1 and s[0] in '"\'`' and s[-1] == s[0]: return [(s[1:-1], False)] if s[1:-1] else []
    if _FILE_LINE.search(s) or s in ('*', ''): return []
    s = re.sub(r'\([^()]*\)$', '', s)                                  # Owner.m(p): the name, not the signature
    word = lambda x: bool(re.fullmatch(r'\w+', x))
    out = [(s, word(s))]
    last = re.split(r'[.#:$]', s)[-1]
    if last and last != s and word(last) and len(last) >= 3: out.append((last, True))
    return out


def _git(repo, args):
    try:
        r = subprocess.run(['git', '-C', repo] + args, capture_output=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired): return None
    return r.stdout.decode('utf-8', 'replace') if r.returncode in (0, 1) else None


def _walk(repo):
    import ax_fresh
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in ax_fresh.PRUNE_ALL and not d.startswith('.')]
        rel = os.path.relpath(root, repo).replace(os.sep, '/')
        for fn in files: yield fn if rel == '.' else f"{rel}/{fn}"


def files(repo):
    """every file of the repository a search by hand would look at: git's (tracked and untracked, not ignored), else
    the refresher's pruned walk"""
    out = _git(repo, ['ls-files', '-co', '--exclude-standard'])
    fs = out.splitlines() if out is not None else list(_walk(repo))
    return [f for f in fs if f and not f.startswith('.axiomcode/')]


def grep(repo, needle, word):
    """[(file, line, text)] of every line holding `needle` (as a whole word when `word`), outside .axiomcode"""
    out = _git(repo, ['grep', '-n', '-I', '--no-color', '--untracked', '-F'] + (['-w'] if word else []) +
               ['-e', needle, '--', '.', ':(exclude).axiomcode'])
    hits = []
    if out is not None:
        for l in out.splitlines():
            m = re.match(r'^(.*?):(\d+):(.*)$', l)
            if m: hits.append((m.group(1), int(m.group(2)), m.group(3)))
        return hits
    pat = re.compile((r'(?<!\w)' + re.escape(needle) + r'(?!\w)') if word else re.escape(needle))
    for f in _walk(repo):
        p = os.path.join(repo, f)
        try:
            if os.path.getsize(p) > 2 << 20: continue
            with open(p, 'rb') as fh: data = fh.read()
        except OSError: continue
        if b'\0' in data[:4096]: continue
        for i, l in enumerate(data.decode('utf-8', 'replace').splitlines(), 1):
            if pat.search(l): hits.append((f, i, l))
    return hits


class Places:
    """the declaration that holds a line, in whichever graph holds its file"""
    def __init__(self, repo):
        self.cons = [c for c in (_con(db) for db in graph_dbs(repo)) if c]
        self.cache = {}

    def graph_file(self, rel):
        """(connection, the path that graph stores for this file) or (None, None). A graph built with --src stores paths
        under it, so a repository path is matched by its longest suffix that some graph holds"""
        if rel in self.cache: return self.cache[rel]
        parts = rel.split('/'); found = (None, None)
        for i in range(len(parts)):
            cand = '/'.join(parts[i:])
            for c in self.cons:
                try:
                    if c.execute("SELECT 1 FROM symbols WHERE file = ? LIMIT 1", (cand,)).fetchone(): found = (c, cand); break
                except Exception: pass
            if found[0]: break
        self.cache[rel] = found
        return found

    def of(self, rel, line):
        """'in <declaration>' for the innermost declaration around the line, 'not indexed' for a file no graph holds,
        '' for a line in an indexed file outside every declaration"""
        c, f = self.graph_file(rel)
        if not c: return 'not indexed'
        try:
            r = c.execute("""SELECT display, kind FROM symbols WHERE file = ? AND line <= ? AND end_line >= ?
                             AND kind NOT IN ('module', 'library', 'written', 'file')
                             ORDER BY line DESC, end_line ASC LIMIT 1""", (f, line, line)).fetchone()
        except Exception: r = None
        return f"in {r[0]}" if r else ''


def block(repo, asked, scope=None, why='unresolved', rows=ROWS):
    """the text lines to print for names the graph could not answer (`asked`), searched under `scope` when some file
    lies there, else at the root (and said so). '' when there is nothing to search for"""
    lines = []
    places = None; rowed = False
    for a in dict.fromkeys(asked):
        tries = needles(a)
        if not tries: continue
        hits, used = [], None
        for n, w in tries:
            hits = grep(repo, n, w); used = (n, w)
            if hits: break
        if why == 'string' and hits:
            # a STRING in a source file is written quoted; the same word bare there is an identifier (a field, a local)
            # and another question. A file no graph reads keeps every mention: a YAML value is written bare
            places = places or Places(repo)
            quoted = re.compile(r'["\'`]' + re.escape(used[0]) + r'["\'`]')
            hits = [h for h in hits if quoted.search(h[2]) or not places.graph_file(h[0])[0]]
        under = ''
        if scope:
            inside = [h for h in hits if scope in h[0]]
            if inside: hits = inside; under = f", under {scope}"
            elif hits: under = f"; none under {scope}, so these are from the whole repository"
        n, w = used
        also = f" (as '{n}')" if n != tries[0][0] else ''
        # a name that reads as a file: the files whose path holds it come first, which is what the search by hand was for
        paths = []
        if _FILE_LIKE.search(tries[0][0]) and ' ' not in tries[0][0]:
            want = tries[0][0].lstrip('./')
            paths = [f for f in files(repo) if f == want or f.endswith('/' + want) or want in f][:rows]
        q = tries[0][0] if not tries[0][1] and a.strip()[:1] in '"\'`' else a       # a quoted string, shown quoted once
        head = {'unresolved': f"the graph has no declaration for '{q}'", 'quoted': f"no declaration is named '{q}'",
                'string': f"'{q}' is a string, so beside the literal sites above",
                'undeclared': f"no graph declares '{q}': the rows above match it by name only, and"}.get(why, f"'{q}'")
        if paths:
            lines.append(f"[text] files whose path holds '{tries[0][0]}' ({len(paths)}{'+' if len(paths) == rows else ''}):")
            lines += [f"    [text] {f}" for f in paths]
        if not hits:
            if not paths and why not in ('string', 'undeclared'):
                lines.append(f"[text] {head}, and no line of the repository's files writes it either"
                             + (f" (nor '{n}')" if len(tries) > 1 else '') + ": absent from the text, not only from the graph.")
            continue
        places = places or Places(repo)
        nfiles = len({h[0] for h in hits})
        rowed = True
        lines.append(f"[text] {head}; the lines that write it{also} — text, not call edges "
                     f"({len(hits)} line(s) in {nfiles} file(s){under}):")
        shown, per = [], {}
        for f, ln, t in sorted(hits, key=lambda h: (h[0], h[1])):
            if per.get(f, 0) >= PER_FILE: continue
            per[f] = per.get(f, 0) + 1; shown.append((f, ln, t))
        # one row per file first, so twelve rows name twelve files rather than one file twelve times
        seen = set(); firsts = []
        for h in shown:
            if h[0] not in seen: seen.add(h[0]); firsts.append(h)
        order = firsts + [h for h in shown if h not in firsts]
        for f, ln, t in order[:rows]:
            where = places.of(f, ln)
            t = t.strip()
            t = t if len(t) <= 110 else t[:107] + '…'
            lines.append(f"    [text] {f}:{ln}" + (f"   {where}" if where else '') + f"   | {t}")
        rest = len(hits) - min(len(order), rows)
        if rest > 0:
            lines.append(f"    … +{rest} more line(s): git grep -n{'w' if w else ''} -F -e '{n}'")
    if not lines: return ''
    if rowed and why == 'unresolved': lines.append("next: these [text] rows are leads, not resolved edges — open the one that fits; for code the graph "
                 "does hold, ask again by the name of the declaration a row sits in")
    return '\n'.join(lines) + '\n'


def emit(repo, asked, scope=None, why='unresolved', rows=ROWS):
    """print the block (a verb alone) or hand what it would search for to the dispatcher (a verb that is one of several)"""
    asked = [a for a in asked if a]
    if not asked: return
    if os.environ.get('AXIOMCODE_FANOUT') == '1':
        sys.stderr.write(MARK + json.dumps({'asked': asked, 'scope': scope, 'why': why, 'rows': rows}) + '\n'); sys.stderr.flush()
        return
    b = block(repo, asked, scope, why, rows)
    if b: sys.stdout.write('\n' + b); sys.stdout.flush()


def take(err):
    """(stderr without the markers, [the marker objects])"""
    keep, got = [], []
    for l in err.splitlines(keepends=True):
        if l.startswith(MARK):
            try: got.append(json.loads(l[len(MARK):]))
            except ValueError: pass
        else: keep.append(l)
    return ''.join(keep), got
