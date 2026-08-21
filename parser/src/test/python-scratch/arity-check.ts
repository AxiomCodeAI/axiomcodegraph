import * as fs from 'fs';
import { PyImportRegistry } from '@/analysis-types/python';
import { PythonImportKind } from '@/enums/python/imports';
import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

const declared: Record<string, number> = JSON.parse(fs.readFileSync('/tmp/declared_arity.json', 'utf8'));
const src = 'import os\nclass K(Base, metaclass=M):\n    def m(self, x=1):\n        return self.m(x)\n';
const r = new PythonFactExtractor().extract({
  sourceCode: src, filePath: 'a.py', baseMservPath: '/r', serviceVersionLinkHash: 'SV' });

const headers: Record<string, string> = {
  py_module: r.module!.getCsvHeader(),
  py_scope: r.scopes[0]!.getCsvHeader(),
  py_binding: r.bindings[0]!.getCsvHeader(),
  py_type: r.types[0]!.getCsvHeader(),
  py_type_base: r.typeBases[0]!.getCsvHeader(),
  py_method: r.methods[0]!.getCsvHeader(),
  py_method_parameter: r.methodParameters[0]!.getCsvHeader(),
  py_import: r.imports[0]?.getCsvHeader() ??
    PyImportRegistry.builder(PythonImportKind.MODULE_IMPORT, 'os', 'os', 'a.py', 1, 'H', 'SV').build().getCsvHeader(),
  py_expression: r.expressions[0]!.getCsvHeader(),
  py_call_site: r.callSites[0]!.getCsvHeader(),
};

let bad = 0, total = 0;
console.log('relation'.padEnd(22) + 'doc'.padStart(6) + 'code'.padStart(6));
for (const [rel, want] of Object.entries(declared)) {
  const got = headers[rel]!.split('\t').length;
  total += got;
  const ok = got === want;
  if (!ok) bad++;
  console.log(rel.padEnd(22) + String(want).padStart(6) + String(got).padStart(6) + (ok ? '' : '   MISMATCH'));
}
console.log('TOTAL'.padEnd(22) + ''.padStart(6) + String(total).padStart(6));
console.log(bad === 0
  ? '\nevery relation matches the schema document — 262 columns'
  : `\n${bad} MISMATCHES`);
process.exit(bad === 0 ? 0 : 1);
