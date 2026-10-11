import { Auth } from './c.js';

export function login(t) {
  return new Auth({ users: [], jwt: null, clock: null }).check(t);
}
