// fixture: type-system/namespaces
// nature: runtime-bearing
//
// Namespaces are TypeScript's pre-ES-modules scoping construct, still ubiquitous
// in .d.ts files and in the compiler's own source. They are the one construct
// whose nature depends on its CONTENTS:
//
//   - a namespace containing only types is fully ERASED
//   - a namespace containing any value emits an IIFE assigned to a variable
//
// So "namespace" is not a nature; each namespace has its own. Both kinds are
// here, labelled, because a parser that treats them alike will either invent a
// runtime entity for the erased ones or lose the real ones.

// --- a namespace containing ONLY types: erased entirely -------------

export namespace Types {
    export interface Point {
        readonly x: number;
        readonly y: number;
    }

    export type Path = readonly Point[];

    export type Transform = (point: Point) => Point;

    // a nested type-only namespace
    export namespace Geometry {
        export interface Circle {
            readonly centre: Point;
            readonly radius: number;
        }
        export type Shape = Circle | { readonly kind: "path"; readonly path: Path };
    }
}

// --- a namespace containing values: emits an IIFE ------------------

export namespace Geometry {
    export const origin: Types.Point = { x: 0, y: 0 };

    export function translate(point: Types.Point, dx: number, dy: number): Types.Point {
        return { x: point.x + dx, y: point.y + dy };
    }

    export class Polygon {
        constructor(readonly points: Types.Path) {}

        get perimeter(): number {
            return this.points.length;
        }
    }

    // a non-exported member: visible inside the namespace, not outside
    const scaleFactor = 2;

    export function scale(point: Types.Point): Types.Point {
        return { x: point.x * scaleFactor, y: point.y * scaleFactor };
    }

    // a nested value namespace, producing a nested IIFE
    export namespace Units {
        export const millimetre = 1;
        export function toMillimetres(value: number): number {
            return value * millimetre;
        }
    }
}

// --- namespace alias by import-equals ----------------------------

import Units = Geometry.Units;
import Point = Types.Point;

// --- qualified references, both value and type -------------------

export function useNamespaces(): string {
    const point: Point = Geometry.origin;
    const moved: Types.Point = Geometry.translate(point, 1, 2);
    const scaled = Geometry.scale(moved);
    const polygon = new Geometry.Polygon([point, moved, scaled]);
    const mm = Units.toMillimetres(3);
    const alsoMm = Geometry.Units.toMillimetres(4);

    const circle: Types.Geometry.Circle = { centre: point, radius: 1 };

    return [polygon.perimeter, mm, alsoMm, circle.radius].join("|");
}

// --- a namespace exported as the module's default shape ---------

export namespace Config {
    export const defaults = { retries: 3 } as const;
    export type Shape = { readonly retries: number };
    export function withRetries(retries: number): Shape {
        return { ...defaults, retries };
    }
}
