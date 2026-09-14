// Same names, different modules. The MODULE a name was imported from is the only
// thing that decides which declaration a call reaches; the simple name gives two
// candidates and no way to choose.
import { Service, process } from "./alpha";
import { Service as BetaService, process as betaProcess } from "./beta";

export function drive(): string {
  const a = new Service();
  const b = new BetaService();
  // A LOCAL declaration shadows the import inside this function.
  const shadowed = (): string => "local";
  return a.run() + b.run() + process() + betaProcess() + shadowed();
}

// ── client -> library ────────────────────────────────────────────────────────
import { Service as LibService, process as libProcess } from "../lib/alpha";

export function useLibrary(): string {
  // Three `Service` classes and three `process` functions are now in scope across
  // two IRs. Only the importing MODULE distinguishes them.
  const l = new LibService();
  return l.run() + libProcess();
}
