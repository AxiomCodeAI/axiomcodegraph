import def, { Base, util, arrow, mutable, swap, renamed, obj, inst } from './lib/base.js';
import * as barrel from './lib/barrel.js';
import * as chain from './lib/chain.js';
import Sub, { ViaNs } from './lib/sub.js';
import './lib/side.js';
import { callCjs } from './lib/mixed.js';
import { loadAndCall } from './lib/dyn.js';
import { utilAlias, BaseAlias, ns, baseDefault } from './lib/barrel.js';
import defBarrel from './lib/barrel.js';
import { nested } from './lib/chain.js';
export function main() {
  def(); util(); arrow(); mutable(); swap(); mutable(); renamed(); obj.m(); inst.id(); new Base().id(); Base.make().id();
  barrel.util(); barrel.utilAlias(); new barrel.BaseAlias().id(); barrel.ns.util(); new barrel.ns.Base().id(); barrel.default(); barrel.baseDefault();
  chain.util(); chain.nested.util(); chain.ns.util(); new chain.Base().id();
  utilAlias(); new BaseAlias().id(); ns.util(); baseDefault(); defBarrel(); nested.util();
  new Sub().id(); new ViaNs().own(); new ViaNs().id(); Sub.make().id();
  callCjs(); loadAndCall();
}
main();
