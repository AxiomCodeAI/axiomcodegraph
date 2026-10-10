import { Reg } from "./registry";

export function use(attachTo?: { readonly parent: Reg }): string {
  return attachTo === undefined ? "" : attachTo.parent.getHash();
}
