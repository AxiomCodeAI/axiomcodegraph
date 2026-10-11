import { S, stamp } from './a.js';

export function use() {
  return new S({ a: 1, b: 2 }).oldName(1, 2);
}

export function twice() {
  return new S({}).oldName(2, 2) + stamp(1).at;
}
