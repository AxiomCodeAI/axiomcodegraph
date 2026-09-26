import { c as fromDir } from './a/b';
import { c as fromDotted } from './a.b';
import { b } from './a';
export function useDir(): number { return fromDir(); }
export function useDotted(): number { return fromDotted(); }
export function useMethod(): number { return new b().c(); }
