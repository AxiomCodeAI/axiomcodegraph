#!/usr/bin/env python3
"""ax_langs.py <repo> <verb-script> [args…]  — ask every language's graph, for a repository written in several.

axiomcode-build gives each language its own graph: the main one (most files) at .axiomcode/out/graph.sqlite, as it
always was, and every other at .axiomcode/lang/<lang>/out/graph.sqlite. A graph holds one language and no call is
followed from one to another; what a question needs is that NONE of them is left out. So the verb runs once per graph
(AXIOMCODE_GRAPH / AXIOMCODE_GRAPH_LANG name it), all at once, and the answers are put together:

  one graph answers       its answer, as it would be alone (another language's is headed with its name)
  several answer          each, headed with its language, the main one first
  none answers            each graph's refusal, headed, and the main graph's exit status
  --json                  the answering graph's object, as it would be alone; when several answer, the main one's
                          (or the first) with `other_languages`: {<lang>: <that graph's object>} added. A reader that
                          knows one language reads the object it always read.

An answer is exit status 0; a refusal (nothing by that name in this graph) is not. Status 3 is a graph with nothing to
say: `changed` and `test-impact` asked about an edit none of whose files is that graph's language (owner() below). It is
left out of the answer, and when every graph says so the main graph's "no change" is the answer.
"""
import concurrent.futures, glob, json, os, subprocess, sys

H = os.path.dirname(os.path.abspath(__file__))


def graphs(repo):
    """[(language, graph dir)], the main graph first as ('', None): its dir is the default the verbs already use"""
    out = [('', None)]
    for d in sorted(glob.glob(os.path.join(repo, '.axiomcode', 'lang', '*'))):
        if os.path.isfile(os.path.join(d, 'out', 'graph.sqlite')): out.append((os.path.basename(d), d))
    return out


# the language whose graph a NEW file belongs to, by extension, in order of preference: a .js file is the JavaScript
# graph's when there is one (the parser gives it to that front end), else TypeScript's, which reads JavaScript too
BY_EXT = {'.py': ('python',), '.pyi': ('python',), '.java': ('java',), '.cs': ('csharp',),
          '.ts': ('typescript',), '.tsx': ('typescript',), '.mts': ('typescript',), '.cts': ('typescript',),
          '.js': ('javascript', 'typescript'), '.jsx': ('javascript', 'typescript'), '.mjs': ('javascript', 'typescript'), '.cjs': ('javascript', 'typescript'),
          # single-file components: only the JavaScript front end reads their <script> blocks
          '.vue': ('javascript',), '.svelte': ('javascript',), '.astro': ('javascript',),
          # pages and stylesheets: the web graph (HTML + CSS); a page's inline scripts are the javascript graph's too
          '.html': ('web',), '.htm': ('web',), '.xhtml': ('web',), '.shtml': ('web',), '.shtm': ('web',), '.css': ('web',)}


def owners(repo, files):
    """{file: the language whose graph answers for it ('' = the main graph)}. A file a graph holds is that graph's; a file
    none holds (new, or skipped) goes by its extension to a language that has a graph, else to the main graph. Every
    file has exactly one owner, so an edit is reported once, by the graph that can read it."""
    import sqlite3
    gs = graphs(repo); main = main_language(repo); held = {}
    for lang, d in gs:
        db = os.path.join(d or os.path.join(repo, '.axiomcode'), 'out', 'graph.sqlite')
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            for (f,) in con.execute("SELECT DISTINCT rel FROM paths"): held.setdefault(f, lang)
            con.close()
        except Exception: pass
    have = {l for l, _ in gs if l} | {main}
    out = {}
    for f in files:
        if f in held: out[f] = held[f]; continue
        pick = next((l for l in BY_EXT.get(os.path.splitext(f)[1], ()) if l in have), '')
        out[f] = '' if pick == main else pick
    return out


def main_language(repo):
    import sqlite3
    try:
        con = sqlite3.connect(f"file:{os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')}?mode=ro", uri=True)
        v = con.execute("SELECT value FROM run WHERE key = 'language'").fetchone(); con.close()
        return v[0] if v else 'main'
    except Exception: return 'main'


def ask(script, args, lang, gdir):
    env = dict(os.environ)
    env['AXIOMCODE_FANOUT'] = '1'
    if gdir: env.update(AXIOMCODE_GRAPH=gdir, AXIOMCODE_GRAPH_LANG=lang)
    r = subprocess.run([sys.executable, os.path.join(H, script)] + args, env=env, capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


def main(argv):
    repo, script, args = os.path.realpath(argv[0]), argv[1], argv[2:]
    gs = graphs(repo)
    if len(gs) == 1:                                    # one language: the verb itself, nothing added
        import ax_exec                                  # never os.execv: on Windows it returns 0 before the answer (#1640)
        ax_exec.become([sys.executable, os.path.join(H, script)] + args)
    first = main_language(repo)
    with concurrent.futures.ThreadPoolExecutor(len(gs)) as ex:
        res = list(ex.map(lambda g: ask(script, args, *g), gs))
    named = [(g[0] or first, g[0] == '', *r) for g, r in zip(gs, res)]
    if all(n[2] == 3 for n in named):                   # no graph has anything to say: the main one says so
        sys.stdout.write(named[0][3]); sys.stderr.write(named[0][4]); return 0
    named = [n for n in named if n[2] != 3]
    named, outside = by_scope(named)
    named, others = by_landing(named)
    # what each graph found nothing by (ax_text.py): searched once, below, and never shown as a graph's stderr
    import ax_text
    marks = []
    for i, n in enumerate(named):
        err, got = ax_text.take(n[4]); marks.append(got); named[i] = (*n[:4], err)
    answered = [n for n in named if n[2] == 0]
    # a graph that could not answer at all keeps its `graph refresh:` lines (a corrupt graph moved aside and being rebuilt,
    # ax_contract.usable_graph): dropped with its refusal, the answer read as whole while a language was missing from it
    notes = ''.join(l + '\n' for n in named if n[2] != 0 and answered for l in n[4].splitlines() if l.startswith('graph refresh:'))
    text = ''
    quoted = [m for ms in marks for m in ms if m.get('why') != 'unresolved']
    if quoted:
        # a string asked about, or quoted in a task, is searched once for the repository, whichever graphs answered
        text = ax_text.block(repo, list(dict.fromkeys(a for m in quoted for a in m['asked'])), quoted[0].get('scope'),
                             quoted[0].get('why'), quoted[0].get('rows') or ax_text.ROWS)
    elif not answered and marks and all(marks):
        # every graph refused and every one of them found nothing by the name: ONE [text] block, not one per language.
        # A graph that refused for another reason (a scope it does not hold, an ambiguous kind) withholds it
        asked = [a for a in marks[0][0]['asked'] if all(any(a in m['asked'] for m in ms) for ms in marks)]
        text = ax_text.block(repo, asked, marks[0][0].get('scope')) if asked else ''
    if not answered:
        # a graph that does not hold the --in scope says only that; the graph that holds it has the refusal that
        # matters (nothing under it matches, or the name is not there), so a scope in one language is judged by it
        held = [n for n in named if not n[3].lstrip().startswith(NOT_HELD)]
        if held: named = held

    if '--json' in args and answered:
        objs = []
        for lang, is_main, rc, out, err in answered:
            try: objs.append((lang, json.loads(out)))
            except ValueError: objs.append((lang, out))
        base_lang, base = objs[0]
        if len(objs) > 1:
            if not isinstance(base, dict): base = {'answer': base}
            base = dict(base, language=base_lang, other_languages={l: o for l, o in objs[1:]})
            print(json.dumps(base, indent=1))
        else:
            print(json.dumps(base, indent=1) if not isinstance(base, str) else base, end='' if isinstance(base, str) else '\n')
        sys.stderr.write(''.join(n[4] for n in answered) + notes)
        return 0
    def _is_json(out):
        try: json.loads(out); return True
        except ValueError: return False
    if '--json' in args and any(_is_json(n[3]) for n in named):
        # no graph answered, but one answered IN JSON (path found no chain: a document with its leads, status 1):
        # still ONE document. Printed as the text answer's per-graph headers instead, a machine reader got
        # `══ typescript graph ══` and nothing it could parse; each other graph's refusal is kept as data and the exit
        # status is the main one's. Refusals that are all text (a name no graph declares) stay text: the pager that
        # asks impact for --json passes a refusal through as written
        objs = []
        for lang, is_main, rc, out, err in named:
            try: objs.append((lang, json.loads(out)))
            except ValueError: objs.append((lang, {'refusal': out.strip()}))
        base_lang, base = objs[0]
        if not isinstance(base, dict): base = {'answer': base}
        base = dict(base, language=base_lang)
        if len(objs) > 1: base['other_languages'] = {l: o for l, o in objs[1:]}
        if text: base['text'] = text
        print(json.dumps(base, indent=1))
        sys.stderr.write(''.join(n[4] for n in named) + notes)
        return named[0][2]

    show = answered or named
    if not answered and len({(n[3], n[4]) for n in named}) == 1 and '--json' in args and not _is_json(named[0][3]):
        # the same text refusal from every graph, asked for --json: one document carrying it, not a header and prose
        print(json.dumps(dict(refusal=named[0][3].strip(), language=named[0][0], languages=[n[0] for n in named],
                              **({'text': text} if text else {})), indent=1))
        sys.stderr.write(named[0][4]); return named[0][2]
    if not answered and len({(n[3], n[4]) for n in named}) == 1:            # the same refusal from every graph: once
        print(f"══ {', '.join(n[0] for n in named)} graph{'s' if len(named) > 1 else ''} ══"); sys.stdout.write(named[0][3]); sys.stderr.write(named[0][4])
        if text: sys.stdout.write('\n' + text)
        return named[0][2]
    # an --in no graph holds is dropped by every graph for the root, and each says so: the line is said once, on top
    gone = [o.split('\n', 1)[0] for _, _, _, o, _ in show if o.startswith(ax_text.SCOPE_GONE)]
    if len(show) > 1 and gone:
        print(gone[0]); show = [(*n[:3], n[3][len(n[3].split('\n', 1)[0]) + 1:] if n[3].startswith(ax_text.SCOPE_GONE) else n[3], n[4]) for n in show]
    for i, (lang, is_main, rc, out, err) in enumerate(show):
        if len(show) > 1 or not is_main:
            print(('' if i == 0 else '\n') + f"══ {lang} graph ══" + ('' if is_main else f"   (.axiomcode/lang/{lang})"), flush=True)
        sys.stdout.write(out); sys.stdout.flush(); sys.stderr.write(err); sys.stderr.flush()
    if notes: sys.stderr.write(notes); sys.stderr.flush()
    if text: sys.stdout.write('\n' + text)
    if answered and others:
        print(f"\nthe --from name is also declared in the {', '.join(others)} graph(s), where its flow reaches "
              "half as many of the task's words or fewer; --lang <language> asks one of them")
    if answered and outside:
        print(f"\nthe name is also declared in the {', '.join(outside)} graph(s), none of it under the --in scope; "
              "drop --in, or --lang <language>, to ask about those")
    return 0 if answered else named[0][2]


LANDING = 'axiomcode-from-landing: '
NOT_HELD = 'no indexed file has '          # ax_contract.require_scope: the --in path is not in this graph at all


SCOPED = 'axiomcode-scope-declared: '       # axiomcode-impact: whether the target's declarations lie under --in


def by_scope(named):
    """(the answers, the languages left out) — `impact <name> --in <path>` in every graph (#1584).

    Every graph that declares the name answered, each for its own declarations, so a scope meant to pick the one
    under it came back with other languages' declarations from elsewhere first. A graph with a declaration under the
    scope answers; one whose declarations all lie outside it is left out and named — when some graph has one inside.
    """
    flag = {}
    for i, n in enumerate(named):
        err = n[4].splitlines(keepends=True)
        for l in err:
            if l.startswith(SCOPED): flag[i] = l[len(SCOPED):].strip() == '1'
        named[i] = (*n[:4], ''.join(l for l in err if not l.startswith(SCOPED)))
    if not any(flag.get(i) and n[2] == 0 for i, n in enumerate(named)): return named, []
    drop = {i for i, n in enumerate(named) if n[2] == 0 and flag.get(i) is False}
    return [n for i, n in enumerate(named) if i not in drop], [named[i][0] for i in sorted(drop)]


def by_landing(named):
    """(the answers, the languages left out) — `context --from <name>` in every graph, the language the task lands in first.

    A common name (main, run, init) is declared in every language's graph, and each graph starts a flow there. Headed
    main-graph-first, the answer a reader met first was a flow in another language than the one the task was about.
    Each graph says how many of the task's words land in the files its flow reaches; the graphs where most land come
    first, and a graph where half as many or fewer land is left out and named, when some other graph does have them.
    """
    land = {}
    for i, n in enumerate(named):
        err = n[4].splitlines(keepends=True)
        for l in err:
            if l.startswith(LANDING):
                try: land[i] = int(l[len(LANDING):])
                except ValueError: pass
        named[i] = (*n[:4], ''.join(l for l in err if not l.startswith(LANDING)))
    if not land or not any(land.get(i, 0) > 0 and n[2] == 0 for i, n in enumerate(named)): return named, []
    # generic words (run, start) land a little in every language: keep the graphs whose flow reaches more than half
    # as many of the task's words as the best one's, as from_starts does between the declarations of one graph
    best = max(land.get(i, 0) for i, n in enumerate(named) if n[2] == 0)
    keep = sorted((i for i, n in enumerate(named) if 2 * land.get(i, 0) > best or n[2] != 0), key=lambda i: -land.get(i, 0))
    return [named[i] for i in keep], [n[0] for i, n in enumerate(named) if i not in keep]


if __name__ == '__main__':
    if len(sys.argv) < 3: sys.exit(__doc__)
    sys.exit(main(sys.argv[1:]))
