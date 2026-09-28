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
          '.js': ('javascript', 'typescript'), '.jsx': ('javascript', 'typescript'), '.mjs': ('javascript', 'typescript'), '.cjs': ('javascript', 'typescript')}


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
        os.execv(sys.executable, [sys.executable, os.path.join(H, script)] + args)
    first = main_language(repo)
    with concurrent.futures.ThreadPoolExecutor(len(gs)) as ex:
        res = list(ex.map(lambda g: ask(script, args, *g), gs))
    named = [(g[0] or first, g[0] == '', *r) for g, r in zip(gs, res)]
    if all(n[2] == 3 for n in named):                   # no graph has anything to say: the main one says so
        sys.stdout.write(named[0][3]); sys.stderr.write(named[0][4]); return 0
    named = [n for n in named if n[2] != 3]
    answered = [n for n in named if n[2] == 0]

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
        sys.stderr.write(''.join(n[4] for n in answered))
        return 0

    show = answered or named
    if not answered and len({(n[3], n[4]) for n in named}) == 1:            # the same refusal from every graph: once
        print(f"══ {', '.join(n[0] for n in named)} graphs ══"); sys.stdout.write(named[0][3]); sys.stderr.write(named[0][4])
        return named[0][2]
    for i, (lang, is_main, rc, out, err) in enumerate(show):
        if len(show) > 1 or not is_main:
            print(('' if i == 0 else '\n') + f"══ {lang} graph ══" + ('' if is_main else f"   (.axiomcode/lang/{lang})"), flush=True)
        sys.stdout.write(out); sys.stdout.flush(); sys.stderr.write(err); sys.stderr.flush()
    return 0 if answered else named[0][2]


if __name__ == '__main__':
    if len(sys.argv) < 3: sys.exit(__doc__)
    sys.exit(main(sys.argv[1:]))
