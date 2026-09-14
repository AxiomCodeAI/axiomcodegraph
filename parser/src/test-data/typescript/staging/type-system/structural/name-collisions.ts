// fixture: type-system/structural/name-collisions
// nature: runtime-bearing
//
// A deliberate-collision fixture. Every member name here is one that a
// name-keyed resolver would recognise from a built-in prototype -- `map`,
// `then`, `get`, `has`, `split`, `filter`, `catch`, `join`, `length`, `set`,
// `forEach`, `reduce`, `slice` -- but NONE of them is the built-in. Each is
// declared in this file, on a local class.
//
// The point is that the structural guard should be exercised, not assumed.
// A resolver that keys on the method NAME, or that guesses a receiver's type
// from how the member reads, will link these call sites to Array, Promise,
// Map or String and be wrong every time. A resolver that requires the
// receiver's type to NAME A DECLARATION IN THIS FILE will get all of them
// right, and will refuse the ones at the bottom that name nothing local.
//
// Nothing here is contrived: `then` on a non-Promise thenable, `get`/`has` on
// a params bag, and `map`/`filter` on a lazy pipeline are all shapes that ship
// in real libraries.

import type { Row as ImportedRow } from "./collision-support";
import { makeRow } from "./collision-support";

// --- a lazy pipeline whose members shadow Array's ---------------------

export class Pipeline<T> {
    constructor(private readonly items: readonly T[]) {}

    // NOT Array.prototype.map
    map<U>(project: (value: T) => U): Pipeline<U> {
        return new Pipeline(this.items.map(project));
    }

    // NOT Array.prototype.filter
    filter(predicate: (value: T) => boolean): Pipeline<T> {
        return new Pipeline(this.items.filter(predicate));
    }

    // NOT Array.prototype.forEach
    forEach(visit: (value: T) => void): this {
        for (const item of this.items) {
            visit(item);
        }
        return this;
    }

    // NOT Array.prototype.reduce
    reduce<A>(step: (acc: A, value: T) => A, seed: A): A {
        let acc = seed;
        for (const item of this.items) {
            acc = step(acc, item);
        }
        return acc;
    }

    // NOT Array.prototype.slice
    slice(from: number): Pipeline<T> {
        return new Pipeline(this.items.slice(from));
    }

    // NOT Array.prototype.join
    join(separator: string): string {
        return this.items.map(String).join(separator);
    }

    // NOT Array.prototype.length -- a getter, not a data property
    get length(): number {
        return this.items.length;
    }
}

// --- a thenable that is NOT a Promise --------------------------------

export class Deferred<T> {
    constructor(private readonly value: T) {}

    // NOT Promise.prototype.then, though `await` will call it
    then<U>(onFulfilled: (value: T) => U): Deferred<U> {
        return new Deferred(onFulfilled(this.value));
    }

    // NOT Promise.prototype.catch
    catch(onRejected: (error: unknown) => T): Deferred<T> {
        void onRejected;
        return this;
    }

    // NOT Promise.prototype.finally
    finally(onSettled: () => void): this {
        onSettled();
        return this;
    }
}

// --- a params bag whose members shadow Map's and URLSearchParams' ----

export class Params {
    private readonly entries: Record<string, string> = {};

    // NOT Map.prototype.get
    get(key: string): string | undefined {
        return this.entries[key];
    }

    // NOT Map.prototype.set
    set(key: string, value: string): this {
        this.entries[key] = value;
        return this;
    }

    // NOT Map.prototype.has
    has(key: string): boolean {
        return key in this.entries;
    }

    // NOT Map.prototype.delete
    delete(key: string): boolean {
        return delete this.entries[key];
    }

    // NOT Map.prototype.size -- a method here, not an accessor
    size(): number {
        return Object.keys(this.entries).length;
    }
}

// --- a path type whose members shadow String's ----------------------

export class Path {
    constructor(readonly value: string) {}

    // NOT String.prototype.split
    split(separator: string): readonly Path[] {
        return this.value.split(separator).map((part) => new Path(part));
    }

    // NOT String.prototype.replace
    replace(from: string, to: string): Path {
        return new Path(this.value.split(from).join(to));
    }

    // NOT String.prototype.startsWith
    startsWith(prefix: string): boolean {
        return this.value.slice(0, prefix.length) === prefix;
    }

    // NOT String.prototype.trim
    trim(): Path {
        return new Path(this.value.trim());
    }
}

// --- call sites: every receiver below is a LOCAL declaration --------

export function callLocalCollisions(rows: readonly ImportedRow[]): string {
    const pipeline = new Pipeline(rows);

    // .map/.filter/.slice/.join/.length here are Pipeline's, not Array's
    const ids = pipeline
        .map((row) => row.id)
        .filter((id) => id.length > 0)
        .slice(0)
        .join(",");
    const count = pipeline.length;
    const folded = pipeline.reduce((acc, row) => acc + row.id.length, 0);
    pipeline.forEach(() => undefined);

    // .then/.catch/.finally here are Deferred's, not Promise's
    const deferred = new Deferred(1).then((n) => n + 1).catch(() => 0);
    deferred.finally(() => undefined);

    // .get/.set/.has/.delete/.size here are Params', not Map's
    const params = new Params().set("a", "1");
    const got = params.get("a") ?? "";
    const present = params.has("a");
    params.delete("b");
    const size = params.size();

    // .split/.replace/.trim here are Path's, not String's
    const path = new Path(" /a/b ").trim().replace("//", "/");
    const parts = path.split("/");

    return [ids, count, folded, got, present, size, parts.length].join("|");
}

// --- the SAME member names on a genuine built-in receiver, so the two
//     cases sit side by side and cannot be conflated ---------------

export function callBuiltinsForContrast(rows: readonly ImportedRow[]): string {
    const array = [...rows];
    const map = new Map<string, ImportedRow>();
    const text = "a/b/c";

    // these ARE Array, Map and String members
    const ids = array.map((row) => row.id).filter(Boolean).join(",");
    map.set("k", makeRow("k"));
    const viaMap = map.get("k")?.id ?? "";
    const present = map.has("k");
    const parts = text.split("/");
    const promised = Promise.resolve(1).then((n) => n + 1);
    void promised;

    return [ids, viaMap, present, parts.length, array.length, map.size].join("|");
}

// --- a local variable named `map`, shadowing nothing but reading like
//     a method: a bare call, not a member access ------------------

export function shadowedByLocalBinding(rows: readonly ImportedRow[]): number {
    const map = (row: ImportedRow): number => row.id.length;
    const get = function (index: number): ImportedRow | undefined {
        return rows[index];
    };
    // bare calls to local bindings that happen to be named after methods
    return map(makeRow("x")) + (get(0) === undefined ? 0 : 1);
}

// --- built-in NAMES shadowed by local declarations in a nested scope -

export function shadowedBuiltinTypes(): string {
    // a local class named Map: `new Map()` in this scope is NOT the global one
    class Map {
        get(key: string): string {
            return `local:${key}`;
        }
    }

    // a local function shadowing a global function
    function parseInt(value: string): string {
        return `local:${value}`;
    }

    const local = new Map();
    return `${local.get("a")}|${parseInt("1")}`;
}

// --- a receiver whose type name exists BOTH locally and as an import,
//     distinguished only by the alias ------------------------------

export interface Row {
    readonly id: string;
    readonly local: true;
}

export function localVersusImportedRow(imported: ImportedRow): string {
    const localRow: Row = { id: "local", local: true };
    // two different declarations, same simple name, one file
    return `${localRow.id}:${localRow.local}:${imported.id}`;
}

// --- members on a type that names NOTHING local: these must resolve to
//     nothing, and that is the correct answer -------------------

export function unresolvableReceivers(rows: readonly ImportedRow[], raw: unknown): number {
    // Row[] and readonly Row[] name Array, not a declaration in this file
    const asArray: ImportedRow[] = [...rows];
    const asFrozen: readonly ImportedRow[] = rows;
    // Promise<Row> names Promise
    const asPromise: Promise<ImportedRow> = Promise.resolve(makeRow("p"));
    // an anonymous object type names nothing at all
    const anonymous: { readonly get: () => string } = { get: () => "x" };
    // `unknown` narrowed to a structural shape names nothing
    const structural = raw as { readonly split: (sep: string) => readonly string[] };

    void asPromise;
    return asArray.length + asFrozen.length + anonymous.get().length + structural.split("/").length;
}
