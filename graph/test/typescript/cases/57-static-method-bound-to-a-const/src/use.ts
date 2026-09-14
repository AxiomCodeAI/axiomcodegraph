import { Util, Wide } from './util';
import * as helpers from './util';

const inSorted = Util.inSorted;
const inherited = Wide.inSorted;
const viaNamespace = helpers.plain;

export function viaAlias(name: string): boolean {
  return inSorted(name, ['a', 'b']);
}

export function viaClass(name: string): boolean {
  return Util.inSorted(name, ['a', 'b']);
}

export function viaInherited(name: string): boolean {
  return inherited(name, ['a', 'b']);
}

export function viaNamespaceAlias(): number {
  return viaNamespace(1);
}
