import { LIMIT, CFG, SCHEMA } from './consts.js';

function use(x) { return x; }

export function topLevelUse() { return LIMIT + 1; }

export function memberRead() { return use(CFG.name); }

export function argRead() { return use(SCHEMA); }
