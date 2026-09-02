// A dependency that ships its TypeScript source next to its built declarations must be
// staged ONCE. Staged twice, every class in it is declared twice and the engine has two
// candidates for one name.
import { Twin } from '@tt/twinsrc';

export function twinPing(t: Twin): string {
  return t.ping();
}
