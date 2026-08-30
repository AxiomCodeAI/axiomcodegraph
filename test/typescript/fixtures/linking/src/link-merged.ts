// DECLARATION MERGING, MODULE AUGMENTATION, AMBIENT MODULES, ENUMS.
//
// Four different ways for the declaration a call resolves to to be somewhere other than
// where the import points.
import { Gauge, takeReading, Level, atLevel } from '@tt/merged';
import { Sink } from '@tt/named';
import { ping } from 'virtual-tools';

// THE CLIENT REOPENS A LIBRARY TYPE. `flush` is declared HERE, on a class declared in
// the library, and a receiver of type Sink must reach both files.
declare module '@tt/named' {
  interface Sink {
    flush(): number;
  }
}

// `Gauge` is a class AND a namespace: the same identifier resolving into two different
// declaration spaces depending on how it is used.
export function readGauge(): number {
  return new Gauge().read();               // -> merged-lib.d.ts  Gauge.read (class)
}

export function calibrated(): number {
  return Gauge.calibrate(2).read();        // -> Gauge.calibrate (namespace), then read
}

// INTERFACE MERGING: `low` is on the first declaration, `high` on the second. A member
// lookup that stops at the first finds one and misses the other.
export function bothEnds(): number {
  const reading = takeReading();
  return reading.low() + reading.high();   // two DIFFERENT declarations of one interface
}

export function levelName(): string {
  return atLevel(Level.High);              // enum member access into the library
}

// The augmented member and the original member, on one receiver.
export function flushAndWrite(sink: Sink): number {
  sink.write('x');                         // -> named-api.d.ts   (library)
  return sink.flush();                     // -> link-merged.ts   (THIS FILE)
}

// An AMBIENT MODULE declared in the client's own .d.ts: the specifier resolves to no
// file on disk at all.
export function pingVirtual(input: string): number {
  return ping(input);                      // -> ambient-virtual.d.ts  ping
}
