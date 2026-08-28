// fixture: type-parameters/generic-classes
// nature: runtime-bearing
// target: TypeScript 6.0.3 (const type parameters since 5.0)
//
// Type parameters declared on runtime-bearing constructs: classes, functions,
// class methods and class fields holding arrow functions. Port of Java's
// `test-simple-type-params.java` and `test-bounded-type-params.java`.
//
// Java bounds are intersections written `T extends A & B`; TypeScript writes
// the same intersection as `T extends A & B`, so bounds port directly. What
// does not port is Java's use-site wildcards -- see type-references/.
//
// Shapes are modelled on Result/Either as they appear in real TypeScript
// codebases, and on the fluent-builder pattern (F-bounded, self-referential).

// --- one type parameter ----------------------------------------------------

export class Box<T> {
    constructor(readonly value: T) {}

    map<U>(fn: (value: T) => U): Box<U> {
        return new Box(fn(this.value));
    }
}

// --- two and three type parameters ----------------------------------------

export class Pair<A, B> {
    constructor(
        readonly first: A,
        readonly second: B,
    ) {}

    swap(): Pair<B, A> {
        return new Pair(this.second, this.first);
    }
}

export class Triple<A, B, C> {
    constructor(
        readonly first: A,
        readonly second: B,
        readonly third: C,
    ) {}
}

// --- descriptive names, as library authors actually write them ------------

export class LruCache<TKey, TValue> {
    private readonly entries = new Map<TKey, TValue>();

    constructor(readonly capacity: number) {}

    put(key: TKey, value: TValue): void {
        if (this.entries.size >= this.capacity) {
            const oldest = this.entries.keys().next();
            if (!oldest.done) {
                this.entries.delete(oldest.value);
            }
        }
        this.entries.set(key, value);
    }

    get(key: TKey): TValue | undefined {
        return this.entries.get(key);
    }
}

// --- a single constraint --------------------------------------------------

export class NumericAccumulator<T extends number> {
    private total = 0;

    add(value: T): void {
        this.total += value;
    }

    get sum(): number {
        return this.total;
    }
}

// --- an intersection constraint (Java's `T extends A & B`) -----------------

export interface Identifiable {
    readonly id: string;
}

export interface Timestamped {
    readonly updatedAt: number;
}

export class Repository<T extends Identifiable & Timestamped> {
    private readonly rows = new Map<string, T>();

    save(entity: T): void {
        this.rows.set(entity.id, entity);
    }

    newest(): T | undefined {
        let best: T | undefined;
        for (const row of this.rows.values()) {
            if (best === undefined || row.updatedAt > best.updatedAt) {
                best = row;
            }
        }
        return best;
    }
}

// --- a constraint that references a sibling type parameter ----------------

export class TypedIndex<TEntity extends Identifiable, TKey extends keyof TEntity> {
    constructor(
        private readonly field: TKey,
        private readonly rows: readonly TEntity[],
    ) {}

    pluck(): Array<TEntity[TKey]> {
        return this.rows.map((row) => row[this.field]);
    }
}

// --- a type parameter with a default --------------------------------------

export class EventBus<TEvents extends Record<string, unknown> = Record<string, never>> {
    private readonly handlers = new Map<keyof TEvents, Array<(payload: never) => void>>();

    on<K extends keyof TEvents>(event: K, handler: (payload: TEvents[K]) => void): void {
        const existing = this.handlers.get(event) ?? [];
        existing.push(handler as (payload: never) => void);
        this.handlers.set(event, existing);
    }
}

// --- constraint plus default together -------------------------------------

export class Paged<TRow extends Identifiable, TCursor extends string | number = string> {
    constructor(
        readonly rows: readonly TRow[],
        readonly cursor: TCursor | undefined,
    ) {}
}

// --- F-bounded / self-referential: the fluent builder ---------------------

export abstract class FluentBuilder<TSelf extends FluentBuilder<TSelf, TResult>, TResult> {
    protected readonly parts: string[] = [];

    with(part: string): TSelf {
        this.parts.push(part);
        return this as unknown as TSelf;
    }

    abstract build(): TResult;
}

export class QueryBuilder extends FluentBuilder<QueryBuilder, string> {
    build(): string {
        return this.parts.join(" ");
    }
}

// --- generic function declarations ----------------------------------------

export function identity<T>(value: T): T {
    return value;
}

export function firstOrDefault<T>(items: readonly T[], fallback: T): T {
    return items.length > 0 ? (items[0] as T) : fallback;
}

// --- a const type parameter (TypeScript 5.0) ------------------------------

export function asTuple<const T extends readonly unknown[]>(...items: T): T {
    return items;
}

// --- a generic arrow function held in a class field -----------------------

export class Mapper<TIn> {
    readonly mapAll = <TOut>(items: readonly TIn[], fn: (item: TIn) => TOut): TOut[] =>
        items.map(fn);
}
