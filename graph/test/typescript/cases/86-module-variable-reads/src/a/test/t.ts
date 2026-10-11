import { CFG, S, TOKENS, make } from '../src';

function use(x: unknown): void {}

export function viaMember(): void {
  use(CFG.name);
}

export function asArgument(): void {
  use(S);
}

export function inTemplate(): string {
  return `${CFG.name}-${TOKENS.Store}`;
}

export function callsTheFunction(): number {
  return make(1);
}

export function shadowed(): string {
  // a local of the same name: the read is the local's, not the module's (control)
  const CFG = { name: 'local' };
  return CFG.name;
}

// a read in a type: at module level it is the module's, in a signature the function's
type T = typeof S;

export function annotated(x: typeof CFG): string {
  return x.name;
}

// a parameter of the same name: `typeof TOKENS` here is the parameter's type (control)
export function shadowedInType(TOKENS: number): typeof TOKENS {
  return TOKENS;
}

function Route(x: unknown): MethodDecorator { return () => {}; }
function Body(x: unknown): ParameterDecorator { return () => {}; }
class Pipe { constructor(readonly s: unknown) {} }

export class Handler {
  // a read in a decorator is the decorated method's: on the method, and on its parameter
  @Route(TOKENS.Store)
  handle(@Body(new Pipe(S)) body: unknown): void {}
}
