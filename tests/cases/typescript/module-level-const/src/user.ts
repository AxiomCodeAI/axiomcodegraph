import { LIMIT } from './consts.js';

export function topLevelUse(): number { return LIMIT + 1; }

export class Holder { cap(): number { return LIMIT * 2; } }

export const arrowUse = () => LIMIT - 1;

import { CFG, SCHEMA } from './consts.js';

function use(x: unknown): void {}

export function memberRead(): void { use(CFG.name); }

export function argRead(): void { use(SCHEMA); }

export function typedRead(s: typeof SCHEMA): void { use(s); }

export type CfgShape = typeof CFG;
