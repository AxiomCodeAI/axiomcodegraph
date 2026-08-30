// DECLARATION MERGING: one name, two declarations, two different kinds. `Gauge` is a
// class AND a namespace, so `Gauge.calibrate()` is a namespace member while
// `new Gauge().read()` is an instance member — the same identifier resolving into two
// different declaration spaces depending on how it is used.
export declare class Gauge {
  read(): number;
}
export declare namespace Gauge {
  function calibrate(offset: number): Gauge;
  const unit: string;
}

// INTERFACE MERGING inside the library: two declarations of one interface, in one file.
// A member lookup that stops at the first declaration finds `low` and misses `high`.
export interface Reading {
  low(): number;
}
export interface Reading {
  high(): number;
}
export declare function takeReading(): Reading;

// A CONST ENUM and a regular enum: the member access is a value with a declaration,
// and const enum members are erased at emit, which is where an IR built from emitted
// JavaScript would lose them.
export declare enum Level {
  Low = 0,
  High = 1,
}
export declare function atLevel(level: Level): string;
