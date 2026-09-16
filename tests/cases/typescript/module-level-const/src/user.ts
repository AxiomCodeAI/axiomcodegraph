import { LIMIT } from './consts.js';

export function topLevelUse(): number { return LIMIT + 1; }

export class Holder { cap(): number { return LIMIT * 2; } }

export const arrowUse = () => LIMIT - 1;
