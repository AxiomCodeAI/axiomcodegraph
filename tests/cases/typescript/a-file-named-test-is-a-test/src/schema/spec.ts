import { area } from '../area/index';

// a specification's shapes, named spec.ts, registering no test
export interface Rect { w: number; h: number }
export const unitArea = (r: Rect): number => area(r.w, r.h);
