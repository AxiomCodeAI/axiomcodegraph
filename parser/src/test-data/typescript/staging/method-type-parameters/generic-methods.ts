// fixture: method-type-parameters/generic-methods
// nature: runtime-bearing
// target: TypeScript 6.0.3 (const type parameters since 5.0)
//
// Port of Java's `GenericMethodLinking.java`: type parameters owned by a
// METHOD rather than by its declaring type.
//
// The cases that make ownership non-trivial are all present:
//   - a method type parameter that shadows a class type parameter of the
//     same name
//   - two overload signatures of one name with different type-parameter
//     arities
//   - a method type parameter constrained by a sibling method type parameter
//   - a static generic method, which cannot see the class type parameters
//     at all
//
// TypeScript adds two forms Java has no syntax for: a type parameter with a
// DEFAULT, and a `const` type parameter. It removes one: a constructor cannot
// declare type parameters (see methods/constructor-patterns.ts).

export interface Identified {
    readonly id: string;
}

export class Registry<T extends Identified> {
    private readonly rows = new Map<string, T>();

    // --- a method type parameter alongside the class one ------------------
    add<U extends T>(row: U): U {
        this.rows.set(row.id, row);
        return row;
    }

    // --- two method type parameters ---------------------------------------
    project<K extends keyof T, V>(key: K, map: (value: T[K]) => V): V[] {
        return [...this.rows.values()].map((row) => map(row[key]));
    }

    // --- a method type parameter that SHADOWS the class type parameter ---
    //     (the inner `T` is a different entity from the class's `T`)
    reinterpret<T extends Identified>(rows: readonly T[]): ReadonlyMap<string, T> {
        const out = new Map<string, T>();
        for (const row of rows) {
            out.set(row.id, row);
        }
        return out;
    }

    // --- a bound that references a SIBLING method type parameter ---------
    narrow<A extends T, B extends A>(wide: A, narrowed: B): B {
        void wide;
        return narrowed;
    }

    // --- an unbounded parameter next to a bounded one -------------------
    zip<A, B extends Identified>(left: readonly A[], right: readonly B[]): Array<[A, B]> {
        const out: Array<[A, B]> = [];
        for (let i = 0; i < Math.min(left.length, right.length); i++) {
            out.push([left[i] as A, right[i] as B]);
        }
        return out;
    }

    // --- a type parameter with a default ---------------------------------
    snapshot<TShape = readonly T[]>(transform: (rows: readonly T[]) => TShape): TShape {
        return transform([...this.rows.values()]);
    }

    // --- a `const` type parameter (TypeScript 5.0) ----------------------
    pick<const K extends readonly (keyof T)[]>(keys: K): K {
        return keys;
    }

    // --- an async generic method -----------------------------------------
    async loadAll<TRaw>(source: () => Promise<readonly TRaw[]>, parse: (raw: TRaw) => T): Promise<T[]> {
        const raws = await source();
        return raws.map(parse);
    }

    // --- a generic generator method --------------------------------------
    *mapped<TOut>(map: (row: T) => TOut): Generator<TOut> {
        for (const row of this.rows.values()) {
            yield map(row);
        }
    }

    // --- a generic method returning the polymorphic `this` type ---------
    filterInPlace<TPred extends (row: T) => boolean>(predicate: TPred): this {
        for (const [key, row] of this.rows) {
            if (!predicate(row)) {
                this.rows.delete(key);
            }
        }
        return this;
    }

    // --- a static generic method: no access to the class type parameter --
    static of<TRow extends Identified>(rows: readonly TRow[]): Registry<TRow> {
        const registry = new Registry<TRow>();
        for (const row of rows) {
            registry.add(row);
        }
        return registry;
    }

    // --- a generic ARROW held in a field: a property, not a method ------
    readonly mapRows = <TOut>(map: (row: T) => TOut): TOut[] =>
        [...this.rows.values()].map(map);
}

// --- overload signatures differing in type-parameter arity -------------

export class Converter {
    convert<T>(value: T): T;
    convert<T, U>(value: T, map: (value: T) => U): U;
    convert<T, U>(value: T, map?: (value: T) => U): T | U {
        return map === undefined ? value : map(value);
    }
}

// --- free generic functions, including intersection-constrained ---------

export function merge<A extends object, B extends object>(left: A, right: B): A & B {
    return { ...left, ...right };
}

export function clamp<T extends number>(value: T, min: T, max: T): T {
    return Math.min(Math.max(value, min), max) as T;
}

export function keysOf<T extends object, K extends Extract<keyof T, string> = Extract<keyof T, string>>(
    source: T,
): K[] {
    return Object.keys(source) as K[];
}

// --- generic methods declared in an object literal ---------------------

export const collectionUtils = {
    head<T>(items: readonly T[]): T | undefined {
        return items[0];
    },
    groupBy<T, K extends string>(items: readonly T[], key: (item: T) => K): Record<K, T[]> {
        const out = {} as Record<K, T[]>;
        for (const item of items) {
            const k = key(item);
            (out[k] ??= []).push(item);
        }
        return out;
    },
};
