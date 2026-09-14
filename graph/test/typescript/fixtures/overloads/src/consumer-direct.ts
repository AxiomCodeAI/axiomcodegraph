// The same calls reached by DIRECT import rather than through the barrel. If the two
// files score differently, the difference is the re-export chain and not the overload
// logic — which is the only way to tell those two failures apart.
import { scale, pad } from '@fixture/math';
import { area } from '@fixture/shapes';
import type { Circle, Square } from '@fixture/shapes';
import { Registry } from '@fixture/registry';
import { format, Box } from '@fixture/callable';

const circle: Circle = { kind: 'circle', radius: 5 };
const square: Square = { kind: 'square', side: 7 };

export function runDirect(): string[] {
  const out: string[] = [];

  out.push(scale('zz', '2'));            // math.ts  scale #0
  out.push(String(scale(9, 9)));         // math.ts  scale #1  NON-FIRST
  out.push(String(scale(false)));        // math.ts  scale #2  NON-FIRST

  out.push(pad('y'));                    // math.ts  pad   #0
  out.push(pad('y', 2));                 // math.ts  pad   #1  NON-FIRST
  out.push(pad('y', 2, '.'));            // math.ts  pad   #2  NON-FIRST

  out.push(String(area(square)));        // shapes.ts area #0
  out.push(String(area(circle)));        // shapes.ts area #1  NON-FIRST

  const reg = new Registry(['a', 'b']);  // registry.ts ctor #2 (readonly string[]) NON-FIRST
  reg.add('q').add(2).add(circle).add(square);
  out.push(String(reg.size()));

  out.push(format(2.5));                 // callable.ts format #0
  out.push(format(2.5, 3));              // callable.ts format #1  NON-FIRST
  out.push(format('b', false));          // callable.ts format #2  NON-FIRST

  const b = new Box('direct');           // callable.ts Box #1  NON-FIRST
  out.push(b.value);

  return out;
}
