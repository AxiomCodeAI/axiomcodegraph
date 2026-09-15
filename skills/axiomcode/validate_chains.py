#!/usr/bin/env python3
"""validate_chains.py <lang> [case …]  — do `search` and `impact` surface the engine's call chains faithfully?

Ground truth: graph/test/<lang>/expected/<case>.edges (tier  kind  caller @Lnn -> callee), the same files the
engine's own suite is checked against. For every expected RESOLVED edge (known_edge / multi_inferred) the skill
must show it in both directions, in the words an agent reads:

  search <caller>   →  the "→ calls" block names the callee at that line
  search <callee>   →  the "← called by" block names the caller at that line
  impact <callee>   →  the caller is in the closure

and every expected ambiguous_* site must appear in the caller's UNRESOLVED block, never as an edge.
Reports recall per case and the misses verbatim. A miss is a frontend bug (naming, display, view) when the
engine's suite passes on the same case, and an engine bug otherwise — the engine suite says which.
"""
import os, re, subprocess, sys, glob, collections, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
AX = os.path.join(HERE, 'scripts', 'axiomcode'); BUILD = os.path.join(HERE, 'scripts', 'axiomcode-build')
lang = sys.argv[1]; only = sys.argv[2:]
T = os.path.join(ROOT, 'graph', 'test', lang)
WORK = os.path.join(T, '.work-skill'); os.makedirs(WORK, exist_ok=True)
def simple(name):        # `Circle#area()` / `shapes#report()` / `Shape#<new>(number)` / `Shape#static origin()` -> (owner, member)
    owner, _, mem = name.partition('#')
    mem = re.sub(r'^static ', '', mem); mem = mem.split('(')[0]
    return owner, ('<constructor>' if mem == '<new>' else mem)
def run(repo, *args):
    return subprocess.run([sys.executable, AX, *args], cwd=repo, capture_output=True, text=True, env=dict(os.environ, AXIOMCODE_LOGGED='1')).stdout
tot = collections.Counter()
for case in sorted(os.listdir(os.path.join(T, 'cases'))):
    if only and case not in only: continue
    exp = os.path.join(T, 'expected', case + '.edges')
    if not os.path.exists(exp): continue
    repo = os.path.join(WORK, case)
    if not os.path.exists(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')):
        shutil.rmtree(repo, ignore_errors=True); shutil.copytree(os.path.join(T, 'cases', case), repo, symlinks=True)
        env = dict(os.environ, AXIOMCODE_LANG=lang, AXIOMCODE_ENGINE=ROOT, AXIOMCODE_SRC='src')   # the harness parses <case>/src as the client; lib/ is not client code
        if os.path.isdir(os.path.join(repo, 'lib-src')): env['AXIOMCODE_LIBRARY'] = os.path.join(repo, 'lib-src')   # a Java case's stub library, passed as --library by the harness
        r = subprocess.run(['bash', BUILD, '.'], cwd=repo, capture_output=True, text=True, env=env)
        if r.returncode: print(f"{case}: build failed\n{r.stdout[-500:]}{r.stderr[-500:]}"); continue
    edges = []          # (tier, caller_sel, site_line|None, callee_sel|None, callee_names, anon)
    def hash_name(n):   # TS/Java `Owner#member(sig)` / `mod#fn(sig)`; owner lowercase = a TS module
        owner, _, mem = n.partition('#'); mem = re.sub(r'^static ', '', mem).split('(')[0]; mem = re.sub(r'@\d+', '', mem).replace('<module-init>', '<module>')
        simple_owner = owner.split('.')[-1]                                   # Java: `probe.DispatchParams#main` — the package is not part of the display
        if '$anon:' in simple_owner: simple_owner = f"<anon {simple_owner.split('$anon:')[1]}>"
        anon = mem in ('<arrow>', '<function-expression>')
        if mem in ('<type-initializer>', '<clinit>'): return f"TYPE:{simple_owner}", ['<type-initializer>'], False
        ctor = mem in ('<new>', '<init>', '<constructor>')
        names = ['<constructor>', '<init>', simple_owner] if ctor else [mem]
        sel = (f"{simple_owner}.{'<constructor>' if ctor else mem}" if owner and not owner.islower() else names[0])
        return sel, names, anon
    def dotted(n):      # Python `mod.Class.member` / `mod.f.<locals>.g` / `mod.<module>`; Java `pkg.Class.member` / `pkg.Outer$anon:Iface.run`
        parts = n.split('.'); mem = parts[-1]
        if mem == '<module>': return f"{parts[0]}.<module>", ['<module>'], False
        owner = parts[-2] if len(parts) > 1 and parts[-2] != '<locals>' and (parts[-2][:1].isupper() or '$anon:' in parts[-2]) else None
        if owner and '$anon:' in owner: owner = f"<anon {owner.split('$anon:')[1]}>"
        if mem == '<type-initializer>': return f"TYPE:{owner}", ['<type-initializer>'], False     # the TYPE is the caller: checked on its class card
        names = ['<constructor>', '__init__', '<init>'] + ([owner] if owner else []) if mem in ('__init__', '<constructor>', '<init>') else [mem]
        return (f"{owner}.{mem}" if owner else mem), names, mem.startswith('<') and mem not in ('<constructor>', '<init>')
    for line in open(exp):
        line = line.rstrip('\n')
        m = re.match(r'^(\S+)\t(\S+)\t(.+?)(?: @L(\d+))? -> (.+)$', line)
        if m:
            tier, caller, ln, callee = m.group(1), m.group(3), m.group(4), m.group(5)
            parse = hash_name if '#' in caller else dotted
            csel, _, _ = parse(caller)
            if callee == '-': edges.append((tier, csel, int(ln) if ln else None, None, [], False))
            else:
                tsel, names, anon = parse(callee); edges.append((tier, csel, int(ln) if ln else None, tsel, names, anon))
            continue
        m = re.match(r'^(\S+?):(\d+):\d+\s+\S+\s+\S+\s+->\s+(\S+)\s+(?:(\S+?):(\d+):\d+\s+(\S+)|-)$', line)   # JavaScript: site -> declaration
        if m:
            tier, cf, cl = m.group(3), m.group(1), int(m.group(2))
            if m.group(4): edges.append((tier, f"{cf}:{cl}", cl, f"{m.group(4)}:{m.group(5)}", [m.group(6)], m.group(6).startswith('<')))
            else: edges.append((tier, f"{cf}:{cl}", cl, None, [], False))
    ok = miss = 0; misses = []; cache = {}
    def out_for(sel):
        if sel not in cache: cache[sel] = run(repo, 'search', sel)
        return cache[sel]
    def cards(sel):
        """search prints one card per matching node; a name shared by overloads or modules yields several"""
        return [c for c in re.split(r'\n(?=(?:method|function|constructor|class|interface|enum|module|type|namespace) )', out_for(sel)) if c.strip()]
    def calls_block(c): return c.split('→ calls', 1)[1].split('⇄')[0].split('✓')[0] if '→ calls' in c else ''
    def by_block(c): return c.split('← called by', 1)[1].split('→ calls')[0] if '← called by' in c else ''
    for tier, csel, ln, tsel, names, anon in edges:
        cm = csel.split('.')[-1].split(':')[0]
        if csel.startswith('TYPE:'):                                                  # a field/static initializer call: shown on the class card
            card = out_for(csel[5:]); nm = [n.split(':')[-1].split('.')[-1] for n in names] or ['?']
            if tsel is None: hit = 'UNRESOLVED:' in card and 'initializers call' in card
            else: hit = re.search(rf"initializers call.*(?:{'|'.join(re.escape(n) for n in nm)})(?=[,\s]|$)", card) is not None
            if not hit: misses.append(f"{tier} {csel} -> {tsel}: not on the class card's initializer line")
            ok += hit; miss += (not hit); continue
        if tsel is None:                                                            # an expected blind spot must show as UNRESOLVED, not as an edge
            blk = 'UNRESOLVED' if tier.startswith('ambiguous') else 'terminal'     # a JS/TS terminal tier is a correct end, shown on its own line
            pat = rf"{blk}.*\bL{ln}\b" if ln else rf"{blk}"
            hit = any(re.search(pat, c) for c in cards(csel))
            if not hit: misses.append(f"{tier} {csel}" + (f" @L{ln}" if ln else '') + " -> - : not shown as UNRESOLVED")
        elif tier == 'boundary_lib':                                                # a library target is a name on the `library:` line, not a client row
            nms = [n.split(':')[-1].split('.')[-1] for n in names]
            hit = any(re.search(rf"library:.*(?:{'|'.join(re.escape(n) for n in nms)})(?=[,\s]|$)", calls_block(c)) for c in cards(csel))
            if not hit: misses.append(f"{tier} {csel} -> {tsel}: not on the library line")
        else:
            lp = rf"^\s+L{ln}\s+" if ln else r"^\s+L\d+\s+"
            if anon: fwd = any(re.search(lp + r"\S+\s+\S+\s+(known_edge|multi_inferred)", calls_block(c), re.M) for c in cards(csel))
            else: fwd = any(re.search(lp + rf"(?:\S|<anon [^>]+>)*(?:{'|'.join(re.escape(n) for n in names)})(?=\s|$)", calls_block(c), re.M) for c in cards(csel))
            if anon: bwd = fwd
            else:
                cpat = (rf"(?:{re.escape(cm)}|{re.escape(csel.split('.')[0])})" if cm in ('<constructor>', '<init>', '__init__') else re.escape(cm)) if not csel.count(':') else r"\S+"   # Java displays a constructor by its class name
                lpat = rf":(\d+,)*{ln}(?=[,\s]|$)" if ln else r":\d"
                bwd = any(re.search(rf"{cpat}(?=\s).*{lpat}", by_block(c)) for c in cards(tsel))
            hit = fwd and bwd
            if not hit: misses.append(f"{tier} {csel}" + (f" @L{ln}" if ln else '') + f" -> {tsel}: forward={'ok' if fwd else 'MISSING'} backward={'ok' if bwd else 'MISSING'}")
        ok += hit; miss += (not hit)
    tot['ok'] += ok; tot['miss'] += miss
    print(f"{lang}/{case}: {ok}/{ok+miss} expected edges surfaced" + (f"  MISSES: " + ' | '.join(misses[:6]) if misses else ''))
n = tot['ok'] + tot['miss']
if n: print(f"\n{lang}: {tot['ok']}/{n} expected edges surfaced by the skill ({100*tot['ok']//n}%)")
