// TYPE FLOW THAT LEAVES THE CLIENT AND COMES BACK.
//
// Every receiver below is produced by a LIBRARY function and consumed by a CLIENT
// method. `first(handlers)` has no type of its own — T is bound by the argument, which
// is a client type — so an engine that treats a library return type as opaque loses the
// receiver entirely and every call in this file goes unresolved.
import { first, wrap, Cell, runAll, fetchRunner } from '@tt/generic';
import type { Runner } from '@tt/generic';

// Client classes implementing a LIBRARY interface: the receiver is typed by the library
// and every body that can run is here. The reverse of the usual direction.
export class FastRunner implements Runner {
  run(input: string): number {
    return input.length;
  }
}

export class SlowRunner implements Runner {
  run(input: string): number {
    return input.length * 2;
  }
}

// A class that satisfies Runner without saying so — structural conformance across the
// library boundary, where the interface is not even in this project.
export class QuietRunner {
  run(input: string): number {
    return 0;
  }
}

// (1) T bound by a client type, member declared in the client.
export function firstRun(runners: readonly FastRunner[]): number {
  return first(runners).run('x');          // -> FastRunner.run  (EXACT: T is FastRunner)
}

// (2) The same shape through an interface-typed array: the fan is the library
//     interface's implementations, which are the three classes above.
export function firstRunIface(runners: readonly Runner[]): number {
  return first(runners).run('x');          // -> Runner.run, fanning to the client bodies
}

// (3) A generic CLASS: the receiver is Cell<FastRunner>, and `get()` returns T.
export function cellRun(): number {
  const cell: Cell<FastRunner> = wrap(new FastRunner());
  return cell.get().run('x');              // -> Cell.get (lib), then FastRunner.run
}

// (4) A generic METHOD on a generic class, whose callback parameter is typed by T.
export function cellMap(): Cell<number> {
  return wrap(new SlowRunner()).map((r) => r.run('y')); // -> Cell.map (lib), SlowRunner.run
}

// (5) The receiver is behind an AWAIT: known only after the promise is unwrapped.
export async function awaitedRun(): Promise<number> {
  const runner = await fetchRunner();
  return runner.run('z');                  // -> Runner.run
}

// (6) A client method reference handed to a library function. The library has no body,
//     so nothing calls it back here — but the ARGUMENT still has to type-resolve.
export function runEverything(): number {
  return runAll([new FastRunner(), new SlowRunner(), new QuietRunner()], 'w');
}
