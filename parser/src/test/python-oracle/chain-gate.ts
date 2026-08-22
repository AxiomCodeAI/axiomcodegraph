/**
 * CALL-CHAIN GATE — can we actually build chains, and out of what?
 *
 *     npx tsx src/test/python-oracle/chain-gate.ts <analyzer-output-dir>
 *
 * Every other gate here scores a call site in isolation. That is not the question
 * the IR exists to answer. The question is whether caller -> callee -> its callees
 * composes, because a fact set can be individually correct and still useless if the
 * edges do not join up.
 *
 * Two things measured, kept apart on purpose:
 *
 *   TRULY RESOLVABLE   a resolution rate over ALL call sites is meaningless, because
 *                      a large share can never resolve to anything in the IR — a
 *                      builtin has no py_method row, `"a,b".join` receives a C type,
 *                      and getattr(o, name)() has no callee to name. Those are
 *                      subtracted, and what remains is the real denominator.
 *
 *   WALKABILITY        every resolved edge must land on a row that EXISTS. A
 *                      constructor call resolves to a py_type, not a py_method, so a
 *                      naive check reports 416 dangling edges that are all valid —
 *                      the walk continues through that class's __init__.
 *
 * Soundness and completeness are reported separately. They fail differently: a wrong
 * edge invents a path that no execution takes, a missing edge truncates a real one.
 */
import * as fs from 'fs'; import * as path from 'path';
const OUT = process.argv[2] ?? '.chain-out';
function tsv(f:string){const fp=path.join(OUT,f); if(!fs.existsSync(fp))return [] as Record<string,string>[];
 const L=fs.readFileSync(fp,'utf-8').split('\n').filter(Boolean); if(!L.length)return [];
 const h=L[0]!.split('\t');return L.slice(1).map(l=>{const c=l.split('\t');
 return Object.fromEntries(h.map((k,i)=>[k,c[i]??''])) as Record<string,string>;});}
const B=new Set<string>(JSON.parse(fs.readFileSync('/tmp/builtins.json','utf-8')));
const calls=tsv('all-python-call-sites.csv'), methods=tsv('all-python-methods.csv'),
      types=tsv('all-python-types.csv');
const mH=new Set(methods.map(m=>m['pyMethodUniqueHash']!));
const tH=new Set(types.map(t=>t['pyTypeUniqueHash']!));
const tot=calls.length;

// ---------- TRULY RESOLVABLE vs NOT ----------
let resolved=0, unresolvableByNature=0, shouldResolve=0;
const nat=new Map<string,number>(), miss=new Map<string,number>();
const bump=(m:Map<string,number>,k:string)=>m.set(k,(m.get(k)??0)+1);
for(const c of calls){
  if(c['resolvedCalleeHash']){resolved++;continue;}
  const n=c['calleeName']||'', rk=c['receiverKind']||'', ck=c['resolvedCalleeKind']||'';
  if(ck==='BUILTIN'){unresolvableByNature++;bump(nat,'builtin, flagged');continue;}
  if(c['callKind']==='DYNAMIC_CALL'){unresolvableByNature++;bump(nat,'dynamic getattr/globals');continue;}
  if(rk==='NONE'&&B.has(n)){unresolvableByNature++;bump(nat,'builtin, NOT flagged (ValueError etc.)');continue;}
  if(rk==='LITERAL'){unresolvableByNature++;bump(nat,'literal receiver -> C type');continue;}
  shouldResolve++;
  bump(miss, rk==='NONE'?'bare name':rk.toLowerCase());
}
console.log(`ALL CALL SITES                      ${tot}`);
console.log(`  RESOLVED                          ${resolved}  ${(100*resolved/tot).toFixed(1)}%`);
console.log(`  NOT RESOLVABLE BY NATURE          ${unresolvableByNature}  ${(100*unresolvableByNature/tot).toFixed(1)}%`);
for(const [k,v] of [...nat].sort((a,b)=>b[1]-a[1])) console.log(`      ${String(v).padStart(5)}  ${k}`);
console.log(`  SHOULD HAVE RESOLVED (MISSED)     ${shouldResolve}  ${(100*shouldResolve/tot).toFixed(1)}%`);
for(const [k,v] of [...miss].sort((a,b)=>b[1]-a[1])) console.log(`      ${String(v).padStart(5)}  ${k}`);
const solvable=resolved+shouldResolve;
console.log(`\n  TRULY RESOLVABLE                  ${solvable}`);
console.log(`  of which we got                   ${resolved}  = ${(100*resolved/solvable).toFixed(1)}%`);
console.log(`  of which we missed                ${shouldResolve}  = ${(100*shouldResolve/solvable).toFixed(1)}%`);

// ---------- CALL CHAIN WALKABILITY ----------
const callsFrom=new Map<string,string[]>();
let bad=0;
for(const c of calls){
  const from=c['pyMethodLinkHash'], to=c['resolvedCalleeHash'];
  if(!from||!to) continue;
  if(!mH.has(to)&&!tH.has(to)){bad++;continue;}
  (callsFrom.get(from)??callsFrom.set(from,[]).get(from)!).push(to);
}
// a constructor edge continues through the class's __init__
const initOf=new Map<string,string>();
for(const m of methods) if(m['name']==='__init__'&&m['pyTypeLinkHash']) initOf.set(m['pyTypeLinkHash']!,m['pyMethodUniqueHash']!);
const step=(h:string)=> tH.has(h) ? (initOf.get(h)?[initOf.get(h)!]:[]) : (callsFrom.get(h)??[]);
console.log(`\nCALL CHAINS`);
console.log(`  edges                             ${[...callsFrom.values()].reduce((a,b)=>a+b.length,0)}`);
console.log(`  edges to an UNKNOWN entity        ${bad}   <- 0 means the graph is walkable`);
const roots=[...callsFrom.keys()];
let d3=0,best={r:0,d:0};
for(const r of roots){
  const seen=new Set([r]); let fr=[r],d=0;
  while(fr.length&&d<15){const nx:string[]=[];
    for(const m of fr) for(const t of step(m)) if(!seen.has(t)){seen.add(t);nx.push(t);}
    if(!nx.length)break; fr=nx; d++;}
  if(d>=3)d3++; if(seen.size>best.r)best={r:seen.size,d};
}
console.log(`  calling methods                   ${roots.length}`);
console.log(`  chains of depth >= 3              ${d3} (${(100*d3/roots.length).toFixed(1)}%)`);
console.log(`  deepest single chain              ${best.d} hops, ${best.r} entities reached`);
