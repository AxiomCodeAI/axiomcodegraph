import zdef, { z, zz, core } from "./ns/index.ts";
import { z as zOuter, alpha } from "./ns/outer.ts";
import * as direct from "./ns/impl.ts";

export function viaNamed(): number { return z.alpha(); }
export function viaAlias(): number { return zz.beta(); }
export function viaDefault(): number { return zdef.gamma(); }
export function viaStarAs(): number { return core.delta(); }
export function viaStarChain(): number { return zOuter.delta(); }
export function topLevelAlpha(): number { return alpha(); }
export function controlDirect(): number { return direct.beta(); }
