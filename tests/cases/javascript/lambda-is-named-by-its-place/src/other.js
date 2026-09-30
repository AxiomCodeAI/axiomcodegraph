import { bump } from './lib.js';

export function wireOther(list) { return list.map((x) => bump(x)); }
