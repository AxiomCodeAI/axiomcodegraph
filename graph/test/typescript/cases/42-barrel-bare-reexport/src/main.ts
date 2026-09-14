import { digest, digestFrom } from "./hash/index";

export function use(): void {
  digest("a");        // through the barrel — the case
  digestFrom("b");    // through the re-export — the control
}
