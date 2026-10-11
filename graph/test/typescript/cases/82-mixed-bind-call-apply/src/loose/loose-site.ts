// Governed by src/loose/tsconfig.json (strictBindCallApply: false) -> Function's
// declarations, although the project's other program is strict.
import { HandlerFactory, plain } from '../factory';

export function looseSites(factory: HandlerFactory, r: object): string {
  const bound = factory.get('a').bind(r);
  factory.get('b').call(r, 'x');
  plain.apply(null, ['y']);
  return bound('z');
}

// CONTROL — a type that declares its own `bind` keeps it under either regime.
interface OwnBindLoose {
  (x: number): number;
  bind(label: string): string;
}

export function ownBindLoose(ob: OwnBindLoose): string {
  return ob.bind('own');
}
