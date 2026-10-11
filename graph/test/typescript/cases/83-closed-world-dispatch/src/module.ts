import { Provided, TypeOnly } from "./impl";

// The container shape: the class crosses a module boundary as an imported value and is
// constructed by code the analysis does not see.
export const providers = [{ provide: "handler", useClass: Provided }];

export let pending: TypeOnly | undefined;
