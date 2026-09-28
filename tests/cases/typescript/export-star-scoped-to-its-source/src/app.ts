import { slugify, trim, helper, score } from './index';
import { clamp as bound } from './aliased';

export function run(): string { return slugify('A') + trim(' b') + helper() + score(1) + bound(2); }
