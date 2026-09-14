/**
 * DOES EACH LINK POINT AT WHAT ITS COLUMN NAME CLAIMS? — meaning, not presence.
 *
 *     node src/test/javascript-gates/link-meaning-check.mjs <sweep-out-dir>
 *
 * ## The blind spot this closes, and why it was shared
 *
 * Every js_method.bodyScopeLinkHash pointed at the ENCLOSING scope, on every row,
 * since the first commit. The FK gate passed: every value was a valid scope hash.
 * js-impl's sufficiency measure passed: it asked whether the column was
 * non-empty. My independent reconciliation AGREED with it exactly — because it
 * asked the same thing. Two measures sharing no traversal, both right about
 * populated-and-resolvable, both wrong about the same column.
 *
 * Independent construction protects against shared CODE. It does not protect
 * against a shared QUESTION. So this asks a different one: for each link column,
 * what does the target have to be TRUE OF for the link to mean what the column
 * says? — and checks that, by STRUCTURE (containment, ownership, identity,
 * name equality, mutuality, same-module), which is deliberately not the
 * question js-impl's new gate asks (kind). Two meaning checks that also do not
 * share their question.
 *
 * ## Positive control
 *
 * The pre-fix fact base is the test: run against ba8846c's output this MUST
 * report bodyScopeLinkHash and FUNCTION_BODY.scopeLinkHash violations by the
 * tens of thousands, and against the fixed parser it must not. A meaning check
 * that cannot see the defect it was built after is worth nothing.
 */
import fs from 'fs';
import path from 'path';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: link-meaning-check.mjs <sweep-out-dir>'); process.exit(1); }
const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);

function read(p) {
  if (!fs.existsSync(p) || fs.statSync(p).size === 0) return null;
  const t = fs.readFileSync(p, 'utf8'); const nl = t.indexOf(NL);
  const h = t.slice(0, nl).split(TAB);
  const idx = Object.fromEntries(h.map((n, i) => [n, i]));
  const rows = t.slice(nl + 1).split(NL).filter(Boolean).map((l) => l.split(TAB));
  return { h, idx, rows };
}
const byPk = (t, pk) => { const m = new Map(); if (t) for (const r of t.rows) m.set(r[t.idx[pk]], r); return m; };
const num = (x) => Number(x);

const INJECT = process.env.LINK_MEANING_INJECT === 'import-owner';
let injected = null;
const checks = {};
const rec = (name, ok, detail) => {
  const c = checks[name] ?? (checks[name] = { total: 0, bad: 0, ex: [] });
  c.total++;
  if (!ok) { c.bad++; if (c.ex.length < 3 && detail) c.ex.push(detail); }
};

let packages = 0;
for (const d of fs.readdirSync(OUT).sort()) {
  const dd = path.join(OUT, d);
  if (!fs.statSync(dd).isDirectory()) continue;
  const mods = read(path.join(dd, 'all-javascript-modules.csv'));
  if (!mods) continue;
  packages++;
  const project = new Set(mods.rows.filter((r) => r[mods.idx.sourceProvenance] === 'PROJECT').map((r) => r[mods.idx.jsModuleUniqueHash]));
  const fileOf = new Map(mods.rows.map((r) => [r[mods.idx.jsModuleUniqueHash], r[mods.idx.filePath]]));

  const T = {
    scope:  read(path.join(dd, 'all-javascript-scopes.csv')),
    method: read(path.join(dd, 'all-javascript-methods.csv')),
    block:  read(path.join(dd, 'all-javascript-blocks.csv')),
    cs:     read(path.join(dd, 'all-javascript-call-sites.csv')),
    expr:   read(path.join(dd, 'all-javascript-expressions.csv')),
    vr:     read(path.join(dd, 'all-javascript-variables.csv')),
    imp:    read(path.join(dd, 'all-javascript-imports.csv')),
    mp:     read(path.join(dd, 'all-javascript-method-parameters.csv')),
    type:   read(path.join(dd, 'all-javascript-types.csv')),
    her:    read(path.join(dd, 'all-javascript-type-heritages.csv')),
  };
  const scopes  = byPk(T.scope, 'jsScopeUniqueHash');
  const methods = byPk(T.method, 'jsMethodUniqueHash');
  const blocks  = byPk(T.block, 'jsBlockUniqueHash');
  const exprs   = byPk(T.expr, 'jsExpressionUniqueHash');
  const vars    = byPk(T.vr, 'jsVariableUniqueHash');
  const imps    = byPk(T.imp, 'jsImportUniqueHash');
  const types   = byPk(T.type, 'jsTypeUniqueHash');
  const bodyOf  = new Map();   // scope hash -> the method whose body it is
  if (T.method) for (const m of T.method.rows) bodyOf.set(m[T.method.idx.bodyScopeLinkHash], m);
  const within = (line, m, mi) => num(line) >= num(m[mi.startLine]) && num(line) <= num(m[mi.endLine]);
  const importOwnerOk = (line, m, mi) => within(line, m, mi);
  const where = (t, r) => `${fileOf.get(r[t.idx.ownerModuleLinkHash])}:${r[t.idx.startLine]}`;

  // ---- js_method ----------------------------------------------------------
  if (T.method && T.scope) {
    const mi = T.method.idx, si = T.scope.idx;
    for (const m of T.method.rows) {
      if (!project.has(m[mi.ownerModuleLinkHash])) continue;
      const self = m[mi.jsMethodUniqueHash];
      // M1  bodyScope: the scope this method OPENS. Its owner must be THIS method,
      //     and it must not be the scope the method is declared IN.
      const body = scopes.get(m[mi.bodyScopeLinkHash]);
      // The module initializer's body IS the MODULE scope, which the schema
      // gives no owning method. Every other callable's body scope is owned by it.
      const isModuleInit = m[mi.methodKind] === 'MODULE_INITIALIZER';
      // The MODULE_INITIALIZER is the one callable whose body scope IS its owner
      // scope — both are the MODULE scope, by design. For every other callable
      // the body is a scope it opens, owned by it, distinct from where it sits.
      if (body) rec('js_method.bodyScopeLinkHash -> scope OWNED BY this method and != ownerScope (initializer: the MODULE scope)',
        isModuleInit ? body[si.scopeKind] === 'MODULE'
          : (body[si.ownerMethodLinkHash] === self && m[mi.bodyScopeLinkHash] !== m[mi.ownerScopeLinkHash]),
        `${where(T.method, m)} ${m[mi.name]}: body scope is ${body[si.scopeKind]} owned by ${body[si.ownerMethodLinkHash] === self ? 'self' : 'ANOTHER method'}`);
      // M2  ownerScope: the scope the method is declared IN — owned by someone else
      //     (or a MODULE/GLOBAL scope), never by this method.
      const owner = scopes.get(m[mi.ownerScopeLinkHash]);
      if (owner) rec('js_method.ownerScopeLinkHash -> scope NOT owned by this method',
        owner[si.ownerMethodLinkHash] !== self, `${where(T.method, m)} ${m[mi.name]}`);
      // M3  enclosingMethod: contains this method by line, and is not self.
      const enc = methods.get(m[mi.enclosingMethodLinkHash]);
      if (enc) rec('js_method.enclosingMethodLinkHash -> method that CONTAINS it, != self',
        enc !== m && within(m[mi.startLine], enc, mi) && num(enc[mi.endLine]) >= num(m[mi.endLine]),
        `${where(T.method, m)} ${m[mi.name]} enclosed by ${enc[mi.name]}@${enc[mi.startLine]}-${enc[mi.endLine]}`);
    }
  }
  // ---- js_scope -----------------------------------------------------------
  if (T.scope) {
    const si = T.scope.idx, mi = T.method?.idx;
    for (const s of T.scope.rows) {
      if (!project.has(s[si.ownerModuleLinkHash])) continue;
      const parent = scopes.get(s[si.parentScopeLinkHash]);
      if (parent) rec('js_scope.parentScopeLinkHash -> scope at depth-1, != self',
        parent !== s && num(parent[si.depth]) === num(s[si.depth]) - 1,
        `${where(T.scope, s)} ${s[si.scopeKind]} depth ${s[si.depth]} -> parent ${parent[si.scopeKind]} depth ${parent[si.depth]}`);
      const om = methods.get(s[si.ownerMethodLinkHash]);
      if (om && mi) rec('js_scope.ownerMethodLinkHash -> method whose range CONTAINS the scope',
        within(s[si.startLine], om, mi), `${where(T.scope, s)} ${s[si.scopeKind]} owned by ${om[mi.name]}@${om[mi.startLine]}-${om[mi.endLine]}`);
    }
  }
  // ---- js_block -----------------------------------------------------------
  if (T.block) {
    const bi = T.block.idx, si = T.scope?.idx, mi = T.method?.idx;
    for (const b of T.block.rows) {
      if (!project.has(b[bi.ownerModuleLinkHash])) continue;
      const parent = blocks.get(b[bi.parentBlockLinkHash]);
      if (parent) rec('js_block.parentBlockLinkHash -> block that STARTS AT OR BEFORE it, != self',
        parent !== b && num(parent[bi.startLine]) <= num(b[bi.startLine]), `${where(T.block, b)} ${b[bi.blockKind]}`);
      const om = methods.get(b[bi.ownerMethodLinkHash]);
      if (om && mi) rec('js_block.ownerMethodLinkHash -> method whose range CONTAINS the block',
        within(b[bi.startLine], om, mi), `${where(T.block, b)} ${b[bi.blockKind]}`);
      // B3  WHAT A BLOCK'S SCOPE MEANS, read off the data and not assumed. My
      //     first version asserted "owned by the same method as the block" —
      //     which PASSED the historical bug and FAILED the fix, because a
      //     FUNCTION_BODY block's ownerMethod is the ENCLOSING method (the one
      //     the block sits in) while its scope is the one the function OPENS.
      //     The structural truth: for a FUNCTION_BODY, exactly one method has
      //     this scope as its bodyScope and it starts on the block's line. For
      //     any other block, the scope is owned by the block's own method, or
      //     is the MODULE scope for a MODULE_BODY.
      const sc = scopes.get(b[bi.scopeLinkHash]);
      if (sc && si && mi) {
        const kind = b[bi.blockKind];
        let ok; let why = '';
        // A static block is minted as a `<static-block>` callable and its block
        // is that callable's body, so it takes the FUNCTION_BODY rule.
        if (kind === 'FUNCTION_BODY' || kind === 'CLASS_STATIC_BLOCK') {
          const owner = bodyOf.get(b[bi.scopeLinkHash]);
          // The owning method CONTAINS its body; it need not start on the same
          // line — a parameter list can span lines before the `{`. 371 arrows
          // with multi-line signatures said so.
          ok = owner !== undefined && within(b[bi.startLine], owner, mi);
          why = owner ? `body of ${owner[mi.name]}@${owner[mi.startLine]}` : 'no method has this scope as its body';
        } else if (kind === 'MODULE_BODY') {
          ok = sc[si.scopeKind] === 'MODULE';
          why = `scope is ${sc[si.scopeKind]}`;
        } else if (kind === 'CLASS_BODY') {
          // A CLASS scope has no owning method by schema design.
          ok = sc[si.scopeKind] === 'CLASS';
          why = `scope is ${sc[si.scopeKind]}`;
        } else {
          ok = sc[si.ownerMethodLinkHash] === b[bi.ownerMethodLinkHash]
            || (sc[si.scopeKind] === 'MODULE' && methods.get(b[bi.ownerMethodLinkHash])?.[mi.methodKind] === 'MODULE_INITIALIZER');
          why = `scope ${sc[si.scopeKind]} owned by ${sc[si.ownerMethodLinkHash] === b[bi.ownerMethodLinkHash] ? 'same' : 'a DIFFERENT'} method`;
        }
        rec('js_block.scopeLinkHash -> body blocks: the scope a method OPENS, containing the block; MODULE/CLASS bodies: that scope kind; else: owned by the block\'s method',
          ok, `${where(T.block, b)} ${kind}: ${why}`);
      }
    }
  }
  // ---- js_call_site <-> js_expression -------------------------------------
  if (T.cs && T.expr) {
    const ci = T.cs.idx, ei = T.expr.idx, mi = T.method?.idx;
    for (const c of T.cs.rows) {
      if (!project.has(c[ci.ownerModuleLinkHash])) continue;
      const e = exprs.get(c[ci.expressionLinkHash]);
      if (e) rec('js_call_site.expressionLinkHash -> expression at the SAME position that links BACK',
        e[ei.startLine] === c[ci.startLine] && e[ei.startColumn] === c[ci.startColumn]
          && e[ei.callSiteLinkHash] === c[ci.jsCallSiteUniqueHash],
        `${where(T.cs, c)} ${c[ci.calleeText].slice(0, 30)} -> expr@${e[ei.startLine]}:${e[ei.startColumn]} kind=${e[ei.expressionKind]}`);
      const em = methods.get(c[ci.enclosingMethodLinkHash]);
      if (em && mi) rec('js_call_site.enclosingMethodLinkHash -> method whose range CONTAINS the call',
        within(c[ci.startLine], em, mi), `${where(T.cs, c)} ${c[ci.calleeText].slice(0, 30)}`);
    }
  }
  // ---- js_expression parent -----------------------------------------------
  if (T.expr) {
    const ei = T.expr.idx;
    for (const e of T.expr.rows) {
      if (!project.has(e[ei.ownerModuleLinkHash])) continue;
      const p = exprs.get(e[ei.parentExpressionLinkHash]);
      if (p) rec('js_expression.parentExpressionLinkHash -> expression at depth-1 whose range CONTAINS it',
        p !== e && num(p[ei.depth]) === num(e[ei.depth]) - 1
          && (num(p[ei.startLine]) < num(e[ei.startLine]) || (num(p[ei.startLine]) === num(e[ei.startLine]) && num(p[ei.startColumn]) <= num(e[ei.startColumn])))
          && (num(p[ei.endLine]) > num(e[ei.endLine]) || (num(p[ei.endLine]) === num(e[ei.endLine]) && num(p[ei.endColumn]) >= num(e[ei.endColumn]))),
        `${where(T.expr, e)} ${e[ei.expressionKind]} d${e[ei.depth]} -> parent ${p[ei.expressionKind]} d${p[ei.depth]} @${p[ei.startLine]}:${p[ei.startColumn]}-${p[ei.endLine]}:${p[ei.endColumn]}`);
    }
  }
  // ---- import <-> variable, by NAME ----------------------------------------
  if (T.imp && T.vr) {
    const ii = T.imp.idx, vi = T.vr.idx;
    // js_variable.endLine equals startLine on all 140,302 rows and has no
    // description in the schema, so it cannot bound anything. The variable's
    // INITIALIZER EXPRESSION has a real range, and a require() call is inside
    // it; a declaration-form import binds on the variable's own line.
    const inRange = (imp, v) => {
      if (num(imp[ii.startLine]) === num(v[vi.startLine])) return true;
      const init = exprs.get(v[vi.initializerExpressionLinkHash]);
      if (!init) return false;
      const ei2 = T.expr.idx;
      return num(imp[ii.startLine]) >= num(init[ei2.startLine]) && num(imp[ii.startLine]) <= num(init[ei2.endLine]);
    };
    for (const i of T.imp.rows) {
      if (!project.has(i[ii.ownerModuleLinkHash])) continue;
      // NAME EQUALITY IS TOO WEAK A MEANING. Two bindings named `install` in
      // two scopes are two variables; a link from the inner one to the OUTER
      // import passes a name check and is wrong. The row for a require binding
      // is positioned AT the binding, so for REQUIRE_CALL the import and its
      // variable share a start line. Declaration-form imports bind at the
      // declaration or specifier, which is also where the variable is minted.
      // Same NAME, and the import's line falls inside the variable's DECLARATION
      // RANGE. Same-line was too strict: `var X =\n  require('m').c.X;` puts the
      // import row on the require and the binding one line up, correctly linked
      // both ways — 7 such pairs read as wrong until the range replaced the line.
      const v = vars.get(i[ii.boundVariableLinkHash]);
      if (v) rec('js_import.boundVariableLinkHash -> variable with the same NAME, on its line or inside its initializer',
        v[vi.name] === i[ii.localName] && inRange(i, v),
        `${where(T.imp, i)} ${i[ii.specifier]} as ${i[ii.localName]} -> variable ${v[vi.name]}@${v[vi.startLine]}-${v[vi.endLine]}`);
    }
    for (const v of T.vr.rows) {
      if (!project.has(v[vi.ownerModuleLinkHash])) continue;
      const i = imps.get(v[vi.importLinkHash]);
      if (i) rec('js_variable.importLinkHash -> import with the same localName, on the variable\'s line or inside its initializer',
        i[ii.localName] === v[vi.name] && inRange(i, v),
        `${where(T.vr, v)} ${v[vi.name]}@${v[vi.startLine]}-${v[vi.endLine]} -> import@${i[ii.startLine]} ${i[ii.specifier]}`);
    }
  }
  // ---- parameters, heritage ------------------------------------------------
  if (T.mp && T.method) {
    const pi = T.mp.idx, mi = T.method.idx;
    for (const p of T.mp.rows) {
      if (!project.has(p[pi.ownerModuleLinkHash])) continue;
      const m = methods.get(p[pi.ownerMethodLinkHash]);
      if (m) rec('js_method_parameter.ownerMethodLinkHash -> method whose range CONTAINS the parameter',
        within(p[pi.startLine], m, mi), `${where(T.mp, p)} ${p[pi.name]} -> ${m[mi.name]}@${m[mi.startLine]}-${m[mi.endLine]}`);
    }
  }
  // ---- imports: who OWNS the row ---------------------------------------------
  // Added 2026-09-13 after js-impl reported 1,071 comment-borne import rows whose
  // owner method was the method the comment DOCUMENTS rather than the one
  // containing it. That defect and its fix landed in one commit (d1bc1ba), so no
  // pushed tree exhibits it; the rule's ability to fail is shown by the injected
  // control at the end of this file instead. The structural claim is the same as
  // for parameters and blocks: the owner's range contains the row.
  if (T.imp && T.method) {
    const ii = T.imp.idx, mi = T.method.idx, si = T.scope?.idx;
    if (INJECT && !injected) {
      // Re-point the first project import at a method that does NOT contain it,
      // through the real read path, so the rule below is exercised as wired.
      const i = T.imp.rows.find(r => project.has(r[ii.ownerModuleLinkHash]));
      const m = i && T.method.rows.find(r => !within(i[ii.startLine], r, mi));
      if (i && m) { i[ii.ownerMethodLinkHash] = m[mi.jsMethodUniqueHash]; injected = `${where(T.imp, i)} -> ${m[mi.name]}@${m[mi.startLine]}-${m[mi.endLine]}`; }
    }
    for (const i of T.imp.rows) {
      if (!project.has(i[ii.ownerModuleLinkHash])) continue;
      const m = methods.get(i[ii.ownerMethodLinkHash]);
      if (m) rec('js_import.ownerMethodLinkHash -> method whose range CONTAINS the import (declaration or JSDoc import type)',
        importOwnerOk(i[ii.startLine], m, mi),
        `${where(T.imp, i)} ${i[ii.importForm]} ${i[ii.specifier]} -> ${m[mi.name]}@${m[mi.startLine]}-${m[mi.endLine]}`);
      // MODULE, BLOCK and CLASS scopes carry no owner method (js_scope.ownerMethodLinkHash
      // is populated on function scopes only — 56,250 of 121,133), so the claim is made
      // at the nearest OWNED ancestor: it must be the import's own owner method, and an
      // import whose scope chain reaches MODULE unowned must belong to the initializer.
      let sc = scopes.get(i[ii.ownerScopeLinkHash]);
      if (sc && si) {
        let hops = 0; while (sc && !sc[si.ownerMethodLinkHash] && sc[si.scopeKind] !== 'MODULE' && hops++ < 64) sc = scopes.get(sc[si.parentScopeLinkHash]);
        const owner = sc?.[si.ownerMethodLinkHash];
        const ok = owner ? owner === i[ii.ownerMethodLinkHash]
          : (sc?.[si.scopeKind] === 'MODULE' && m?.[mi.methodKind] === 'MODULE_INITIALIZER');
        rec('js_import.ownerScopeLinkHash -> nearest OWNED ancestor scope is owned by the import\'s owner method (MODULE unowned: the initializer)',
          ok, `${where(T.imp, i)} ${i[ii.importForm]} ${i[ii.specifier]} -> scope chain reaches ${sc?.[si.scopeKind] ?? 'nothing'} owned by ${owner ? 'a DIFFERENT method' : 'nobody'}; import owner ${m?.[mi.methodKind]}`);
      }
    }
  }
  if (T.her && T.type) {
    const hi = T.her.idx, ti = T.type.idx;
    for (const h of T.her.rows) {
      if (!project.has(h[hi.ownerModuleLinkHash])) continue;
      const t = types.get(h[hi.ownerTypeLinkHash]);
      // Only an EXTENDS_CLAUSE sits inside its type's range. util.inherits, a
      // prototype assignment and Object.create all FOLLOW the constructor by
      // construction, so containment is the wrong meaning for them; for those the
      // structural claim is weaker — same module, type declared BEFORE the edge.
      const form = h[hi.heritageForm];
      // A function declaration HOISTS: `Buffer.prototype = X.prototype` at line
      // 132 with `function Buffer` at 270 is legal and correctly attributed, so
      // source ORDER is not a meaning for the call/assignment forms. For those
      // the only structural claim is same-module, which the sweep below makes.
      if (t && form === 'EXTENDS_CLAUSE') rec(
        'js_type_heritage.ownerTypeLinkHash (EXTENDS_CLAUSE) -> type whose range CONTAINS the clause',
        within(h[hi.startLine], t, ti), `${fileOf.get(h[hi.ownerModuleLinkHash])}:${h[hi.startLine]} extends ${h[hi.superTypeName]} -> ${t[ti.name]}@${t[ti.startLine]}-${t[ti.endLine]}`);
    }
  }
  // ---- SAME MODULE, for every intra-file link ------------------------------
  for (const [tname, t] of Object.entries(T)) {
    if (!t) continue;
    const targets = { scope: scopes, method: methods, block: blocks, expr: exprs, vr: vars, imp: imps, type: types };
    for (const col of t.h) {
      if (!col.endsWith('LinkHash') || col.startsWith('serviceVersion') || col === 'ownerModuleLinkHash') continue;
      if (col.startsWith('resolved') || col === 'importLinkHash' && tname === 'cs') continue; // cross-file by design
      const target = col.includes('Scope') ? scopes : col.includes('Method') ? methods : col.includes('Block') ? blocks
        : col.includes('Expression') ? exprs : col.includes('Variable') ? vars : col.includes('Import') ? imps
        : col.includes('Type') && !col.includes('TypeReference') ? types : null;
      if (!target) continue;
      const ti = target === scopes ? T.scope?.idx : target === methods ? T.method?.idx : target === blocks ? T.block?.idx
        : target === exprs ? T.expr?.idx : target === vars ? T.vr?.idx : target === imps ? T.imp?.idx : T.type?.idx;
      if (!ti) continue;
      for (const r of t.rows) {
        if (!project.has(r[t.idx.ownerModuleLinkHash])) continue;
        const x = target.get(r[t.idx[col]]);
        if (x) rec(`SAME MODULE: ${tname}.${col}`, x[ti.ownerModuleLinkHash] === r[t.idx.ownerModuleLinkHash]);
      }
    }
  }
}

console.log(`packages: ${packages}\n`);
console.log('LINK MEANING — does the target satisfy what the column name claims?');
let violations = 0;
const rows = Object.entries(checks).sort((a, b) => (b[1].bad / b[1].total) - (a[1].bad / a[1].total));
for (const [name, c] of rows) {
  if (name.startsWith('SAME MODULE')) continue;
  violations += c.bad;
  console.log(`  ${String(c.bad).padStart(7)} / ${String(c.total).padStart(8)}  ${(100 * c.bad / c.total).toFixed(2).padStart(6)}%  ${name}`);
  for (const e of c.ex) console.log(`             e.g. ${e}`);
}
const sm = rows.filter(([n]) => n.startsWith('SAME MODULE'));
const smBad = sm.reduce((a, [, c]) => a + c.bad, 0), smTot = sm.reduce((a, [, c]) => a + c.total, 0);
console.log(`  ${String(smBad).padStart(7)} / ${String(smTot).padStart(8)}  ${(100 * smBad / Math.max(smTot, 1)).toFixed(2).padStart(6)}%  SAME MODULE, all ${sm.length} intra-file link columns`);
for (const [n, c] of sm) if (c.bad) console.log(`             ${c.bad} in ${n}`);
violations += smBad;
console.log(violations === 0 ? '\nEVERY LINK MEANS WHAT ITS COLUMN CLAIMS.' : `\n${violations} link(s) are populated, resolvable and WRONG.`);
if (INJECT) {
  // The injected control: one import re-pointed at a non-containing method must
  // surface as exactly that rule's violation. A clean result here is the failure.
  const c = checks['js_import.ownerMethodLinkHash -> method whose range CONTAINS the import (declaration or JSDoc import type)'];
  const caught = injected && c && c.bad >= 1;
  console.log(`\nINJECTED CONTROL (import owner): ${injected ? 'planted ' + injected : 'NOTHING PLANTED'} -> ${caught ? 'CAUGHT' : 'NOT CAUGHT'}`);
  process.exit(caught ? 0 : 1);
}
process.exit(violations === 0 ? 0 : 1);
