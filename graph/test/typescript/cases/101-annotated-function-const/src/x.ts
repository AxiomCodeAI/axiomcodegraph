import * as formats from "./formats";
import { fromArrow, fromAlias, made, Format, Fn } from "./formats";

export function viaNamespace(s: string): string { return formats.fromArrow(s); }
export function viaNamed(s: string): string { return fromArrow(s); }
const local: Format = (i) => i;
export function viaLocal(s: string): string { return local(s); }

export function aliasNamespace(s: string): string { return formats.fromAlias(s); }
export function aliasNamed(s: string): string { return fromAlias(s); }
const localAlias: Fn = (i) => i;
export function aliasLocal(s: string): string { return localAlias(s); }

// controls: no literal to find, so the annotation's signature stays the target.
export function factoryNamed(s: string): string { return made(s); }
export function factoryNamespace(s: string): string { return formats.made(s); }
export function viaParam(f: Format, s: string): string { return f(s); }
