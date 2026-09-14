// OVERLOAD RESOLUTION ACROSS THE LIBRARY BOUNDARY.
//
// The client-side fixture measures overloads inside one project. This asks the harder
// question: the candidate set has to survive extraction into library IR, staging and
// re-linking before any comparison can happen. If overloads/ scores 1.000 and this file
// does not, the difference is the library path — which is the only way to tell those two
// failures apart.
//
// Order is hostile: the ordinary argument never selects declaration 0.
import { convert, join, Painter } from '@tt/overload';
import type { Frame, Panel } from '@tt/overload';

const frame: Frame = { kind: 'frame', width: 4 };
const panel: Panel = { kind: 'panel', height: 9 };

export function convertAll(): unknown[] {
  return [
    convert('ff', '16'),                   // convert #0  (string, string)
    convert(255, 16),                      // convert #1  (number, number)   NON-FIRST
    convert(true),                         // convert #2  (boolean)          NON-FIRST
  ];
}

export function joinAll(): string[] {
  return [
    join('a'),                             // join #0  arity 1
    join('a', 'b'),                        // join #1  arity 2               NON-FIRST
    join('a', 'b', 'c'),                   // join #2  arity 3               NON-FIRST
  ];
}

// The overloaded METHOD's parameter types are declared inside the library, so the
// argument type has to be resolved through the library's own type graph before the
// candidates can be compared.
export function paintAll(): number[] {
  const painter = new Painter('seed');     // Painter ctor #1  (string)      NON-FIRST
  const scaled = new Painter(2, 3);        // Painter ctor #2  (number,number) NON-FIRST
  return [
    painter.draw(panel),                   // draw #0  (Panel)
    painter.draw(frame),                   // draw #1  (Frame)               NON-FIRST
    painter.draw('label'),                 // draw #2  (string)              NON-FIRST
    scaled.draw(panel),                    // draw #0  (Panel)
  ];
}
