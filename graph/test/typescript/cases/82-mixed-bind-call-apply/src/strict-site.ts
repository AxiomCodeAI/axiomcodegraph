// Governed by src/tsconfig.json (strict) -> CallableFunction's declarations.
import { HandlerFactory, plain } from './factory';

export function strictSites(factory: HandlerFactory, r: object): string {
  const bound = factory.get('a').bind(r);
  factory.get('b').call(r, 'x');
  plain.apply(null, ['y']);
  return bound('z');
}

// CONTROL — a type that declares its own `bind` keeps it under either regime.
interface OwnBind {
  (x: number): number;
  bind(label: string): string;
}

export function ownBindStrict(ob: OwnBind): string {
  return ob.bind('own');
}
