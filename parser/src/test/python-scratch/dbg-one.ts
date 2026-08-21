import * as fs from 'fs';
import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';
const f = process.argv[2]!;
const r = new PythonFactExtractor().extract({
  sourceCode: fs.readFileSync(f, 'utf8'), filePath: f, baseMservPath: '/r',
  moduleQualifiedName: 'm', serviceVersionLinkHash: 'SV' });
const name = process.argv[3]!;
const tByHash = new Map(r.types.map(t => [t.getHash(), t]));
for (const c of r.callSites) {
  if (c.getCalleeName() !== name) continue;
  const owner = tByHash.get(c.getPyTypeLinkHash());
  console.log(`call line ${c.getStartLine()} receiver=${c.getReceiverKind()} owner=${owner?.getName() ?? '(none)'} -> ${c.getResolvedCalleeKind()}`);
}
console.log('\nclasses declaring it:');
r.methods.filter(m => m.getName() === name).forEach(m => {
  const t = tByHash.get(m.getPyTypeLinkHash());
  console.log(`  ${t?.getName() ?? '(module)'}  classBodyMember=${m.isClassBodyMember()} stub=${m.getBodyIsStub()} kind=${m.getMethodKind()}`);
});
console.log('\nbases:');
for (const b of r.typeBases) {
  const sub = tByHash.get(b.getPyTypeLinkHash());
  if (!sub || !['_SelectorTransport','_SelectorSocketTransport'].includes(sub.getName())) continue;
  console.log(`  ${sub.getName()} <- ${b.getBaseDottedPath() || b.getBaseSimpleName()} resolved=${b.getIsResolvedLocally()}`);
}
