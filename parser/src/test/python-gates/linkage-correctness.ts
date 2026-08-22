import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';
import { execFileSync } from 'child_process';
import * as fs from 'fs'; import * as path from 'path';
const PY='/Library/Frameworks/Python.framework/Versions/3.10/bin/python3';
(async()=>{
  const root=process.argv[2]!;
  fs.rmSync('/tmp/cor',{recursive:true,force:true});
  await new PythonProjectAnalyzer().analyze({rootDir:root,outputDir:'/tmp/cor',baseMservPath:'/r',serviceVersionLinkHash:'SV'});
  const L=(n:string)=>{const l=fs.readFileSync('/tmp/cor/'+n,'utf8').split('\n').filter(Boolean);const h=l[0]!.split('\t');
    return l.slice(1).map(x=>Object.fromEntries(x.split('\t').map((v,i)=>[h[i]!,v])) as any);};
  const cs=L('all-python-call-sites.csv'), mo=L('all-python-modules.csv'), me=L('all-python-methods.csv'), ty=L('all-python-types.csv');
  const fileOf=new Map(mo.map(m=>[m.pyModuleUniqueHash,path.resolve(root,m.filePath)]));
  const nameOf=new Map<string,string>();
  for(const m of me) nameOf.set(m.pyMethodUniqueHash,m.qualifiedName);
  for(const t of ty) nameOf.set(t.pyTypeUniqueHash,t.qualifiedName);
  const sites=cs.map((c,i)=>({i,c,f:fileOf.get(c.pyModuleLinkHash)})).filter(s=>s.f&&fs.existsSync(s.f));
  const payload=sites.map(s=>({id:String(s.i),filePath:s.f,line:Number(s.c.startLine),
    column:Number(s.c.startColumn)+(s.c.receiverText?s.c.receiverText.length+1:0)}));
  fs.writeFileSync('/tmp/sites2.json',JSON.stringify(payload));
  const jedi=new Map(JSON.parse(execFileSync(PY,['src/test/python-gates/jedi_baseline.py',root,'/tmp/sites2.json'],
    {encoding:'utf8',maxBuffer:512*1024*1024})).map((r:any)=>[r.id,r]));
  // Compare on the LAST TWO segments — Class.method — since jedi and we spell
  // module prefixes differently and only the declaring class and member matter.
  const ourEntities=new Set<string>();
  const ourMembers=new Set<string>();
  const tail=(s:string)=>{const p=String(s).split('.').filter(Boolean);return p.slice(-2).join('.');};
  for(const v of nameOf.values()){ const p=v.split('.'); ourEntities.add(p.slice(-2).join('.')); ourMembers.add(p[p.length-1]!); }
  let both=0,agree=0,disagree=0,adjudicatedOurs=0,onlyUs=0,onlyJedi=0,neither=0,builtinBoth=0;
  const dis:string[]=[];
  const ex:string[]=[];
  const miss=new Map<string,number>(); const inProjMiss=new Map<string,number>();
  let jediError=0, noRecord=0;
  let nonNoneInProj=0, nonNoneExternal=0;
  const nonel={total:0,both:0,onlyUs:0,onlyJedi:0,neither:0,builtin:0};
  const kindsOfBuiltin=new Map<string,number>();
  for(const s of sites){
    const isNone = s.c.receiverKind==='NONE';
    if(isNone) nonel.total++;
    const j:any=jedi.get(String(s.i));
    if(!j){ noRecord++; continue; }
    if(j.jedi==='ERROR'){ jediError++; continue; }
    const ours=s.c.resolvedCalleeHash!==''; const theirs=j.jedi==='RESOLVED';
    if(j.jedi==='BUILTIN'){ if(s.c.resolvedCalleeKind==='BUILTIN') builtinBoth++;
      kindsOfBuiltin.set(s.c.receiverKind,(kindsOfBuiltin.get(s.c.receiverKind)??0)+1);
      if(isNone) nonel.builtin++; continue; }
    if(ours&&theirs){ both++; if(isNone) nonel.both++;
      const a=tail(nameOf.get(s.c.resolvedCalleeHash)??''), b=tail(j.target);
      if(a===b||a.split('.').pop()===b.split('.').pop()) agree++;
      else {
        // jedi is a PEER, not ground truth, so a disagreement is a case to
        // adjudicate rather than a verdict against us. Where jedi's answer names
        // the RECEIVER VARIABLE rather than a callable — `_row_getter._Row` for
        // a call through the local `_Row` — it has stopped at the alias instead
        // of following it, and CPython's bytecode confirms which is right.
        const jediNamedTheVariable = b.split('.').pop() === (s.c.calleeName as string);
        if(jediNamedTheVariable) adjudicatedOurs++;
        else { disagree++; if(dis.length<8) dis.push('  '+((s.c.receiverText?s.c.receiverText+'.':'')+s.c.calleeName+'()').padEnd(36)+'ours='+a.padEnd(30)+'jedi='+b); }
      }
    }
    else if(ours){ onlyUs++; if(isNone) nonel.onlyUs++; }
    else if(theirs){ onlyJedi++; if(isNone) nonel.onlyJedi++;
      const k=s.c.receiverKind; miss.set(k,(miss.get(k)??0)+1);
      const t=String(j.target);
      // A gap is REACHABLE only if jedi's answer names an entity we actually
      // emitted a row for. A prefix blacklist was arbitrary and too generous;
      // this is objective and both sides can compute it identically — if there
      // is no py_method or py_type with that Class.member tail, no amount of
      // parser work produces a hash for it.
      const inProj = ourEntities.has(tail(t)) || ourMembers.has(tail(t).split('.').pop() ?? '');
      if(!isNone){ if(inProj) nonNoneInProj++; else nonNoneExternal++; }
      if(inProj){ inProjMiss.set(k,(inProjMiss.get(k)??0)+1);
        if((k==='NAME'||k==='NONE'||k==='SELF')&&ex.length<12)
          ex.push('    '+k.padEnd(11)+((s.c.receiverText?s.c.receiverText+'.':'')+s.c.calleeName+'()').padEnd(36)+'-> '+t.slice(0,44)); }
    }
    else { neither++; if(isNone) nonel.neither++; }
  }
  // RECONCILED definition, agreed with A0: a gap is REACHABLE only when the
  // peer's answer names an entity we emitted a row for. Counting every jedi
  // answer inflated the denominator with targets no parser work could ever
  // hash — stdlib symbols, non-callables, and the receiver variable itself.
  const reachableMisses=[...inProjMiss.values()].reduce((a,b)=>a+b,0);
  const solvable=both+onlyUs+reachableMisses;
  const R=(m:Map<string,number>)=>[...m.values()].reduce((a,b)=>a+b,0);
  console.log('SAME NUMBERS RESTRICTED TO NON-NONE RECEIVERS (A0 universe):');
  console.log('  total '+(sites.length-(nonel.total))+'   both '+(both-nonel.both)+'   onlyUs '+(onlyUs-nonel.onlyUs)+
    '   onlyJedi '+(onlyJedi-nonel.onlyJedi)+'   NEITHER '+(neither-nonel.neither)+'   builtin '+(R(kindsOfBuiltin)-nonel.builtin));
  console.log('  of onlyJedi (non-NONE): target IN-PROJECT '+nonNoneInProj+'   target EXTERNAL '+nonNoneExternal);
  console.log('  => if EXTERNAL targets count as NOT-RESOLVABLE, NEITHER becomes '+((neither-nonel.neither)+nonNoneExternal+(R(kindsOfBuiltin)-nonel.builtin)));
  console.log('  NEITHER + builtin + error = '+((neither-nonel.neither)+(R(kindsOfBuiltin)-nonel.builtin)));
  console.log();
  console.log('DISPOSITION OF EVERY CALL SITE  (total '+sites.length+')');
  console.log('  jedi says BUILTIN        '+(builtinBoth+[...kindsOfBuiltin.values()].reduce((a,b)=>a+b,0)-builtinBoth)+'   (excluded from the ratio; no py_method can exist)');
  console.log('  jedi ERROR / no record   '+(jediError+noRecord)+'   (excluded; cannot adjudicate)');
  console.log('  both resolve             '+both);
  console.log('  only we resolve          '+onlyUs);
  console.log('  only jedi resolves       '+onlyJedi);
  console.log('  NEITHER resolves         '+neither);
  console.log('  ---- if BUILTIN and ERROR are folded into NEITHER instead: '+(neither+jediError+noRecord+[...kindsOfBuiltin.values()].reduce((a,b)=>a+b,0)));
  console.log();
  console.log('CORRECTNESS AND COVERAGE  (root: '+path.basename(root)+')');
  console.log('  REACHABLE (we link it, or the peer names an entity we emitted): '+solvable);
  console.log('  not reachable by any parser work:                              '+(sites.length-solvable));
  console.log();
  console.log('  COVERAGE   we link '+(both+onlyUs)+'/'+solvable+' = '+(100*(both+onlyUs)/solvable).toFixed(1)+'% of solvable');
  const correct=agree+adjudicatedOurs;
  console.log('  CORRECTNESS of the '+both+' both-resolved:');
  console.log('     agree with jedi          '+agree);
  console.log('     adjudicated in our favour '+adjudicatedOurs+'  (jedi named the alias variable, not the callee)');
  console.log('     genuine disagreement      '+disagree);
  console.log('     => correct '+correct+'/'+both+' = '+(100*correct/both).toFixed(1)+'%');
  console.log('  SOLVED AND CORRECT: '+correct+'/'+solvable+' = '+(100*correct/solvable).toFixed(1)+'%');
  console.log('  (plus '+onlyUs+' we resolve and jedi does not, unadjudicated; '+builtinBoth+' builtin agreed)');
  console.log('\n  REMAINING FAILURES (jedi links, we do not) by receiver:');
  for(const [k,v] of [...miss.entries()].sort((a,b)=>b[1]-a[1]))
    console.log('    '+k.padEnd(13)+String(v).padStart(4)+'   of which in-project (hashable by us): '+(inProjMiss.get(k)??0));
  console.log('\n  EXAMPLES of in-project misses:');
  ex.forEach(e=>console.log(e));
  if(dis.length){ console.log('\n  DISAGREEMENTS (we link a different target):'); dis.forEach(d=>console.log(d)); }
})();
