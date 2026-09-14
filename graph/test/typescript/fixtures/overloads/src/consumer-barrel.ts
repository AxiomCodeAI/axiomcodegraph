// Every call here reaches its overload set THROUGH THE BARREL. The comment on each
// line names the declaration the compiler must select, so a reader can check the
// engine's answer against the source without running anything.
import { scale, pad, area, Registry, format, Box } from '@fixture/index';
import type { Circle, Square } from '@fixture/index';

const circle: Circle = { kind: 'circle', radius: 2 };
const square: Square = { kind: 'square', side: 3 };

export function run(): string[] {
  const out: string[] = [];

  out.push(scale('ab', '3'));            // math.ts  scale #0  (string, string)
  out.push(String(scale(4, 5)));         // math.ts  scale #1  (number, number)  NON-FIRST
  out.push(String(scale(true)));         // math.ts  scale #2  (boolean)         NON-FIRST

  out.push(pad('x'));                    // math.ts  pad   #0  arity 1
  out.push(pad('x', 4));                 // math.ts  pad   #1  arity 2           NON-FIRST
  out.push(pad('x', 4, '-'));            // math.ts  pad   #2  arity 3           NON-FIRST

  out.push(String(area(square)));        // shapes.ts area  #0  (Square)
  out.push(String(area(circle)));        // shapes.ts area  #1  (Circle)         NON-FIRST

  const reg = new Registry('seed');      // registry.ts ctor  #1  (string)       NON-FIRST
  reg.add('a');                          // registry.ts add   #0  (string)
  reg.add(1);                            // registry.ts add   #1  (number)       NON-FIRST
  reg.add(circle);                       // registry.ts add   #2  (Circle)       NON-FIRST
  reg.add(square);                       // registry.ts add   #3  (Square)       NON-FIRST
  out.push(String(reg.size()));

  out.push(format(1.5));                 // callable.ts format #0 (number)
  out.push(format(1.5, 2));              // callable.ts format #1 (number,number) NON-FIRST
  out.push(format('a', true));           // callable.ts format #2 (string,boolean) NON-FIRST

  const b0 = new Box();                  // callable.ts Box    #0  ()
  const b1 = new Box('v');               // callable.ts Box    #1  (string)       NON-FIRST
  out.push(b0.value, b1.value);

  return out;
}
