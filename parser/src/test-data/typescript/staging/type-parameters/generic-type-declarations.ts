// fixture: type-parameters/generic-type-declarations
// nature: type-only
// target: TypeScript 6.0.3 (variance annotations since 4.7)
//
// Type parameters on constructs that have NO runtime existence: interfaces,
// type aliases, function types, constructor types, and generic method
// signatures inside an interface. Nothing in this file is emitted, so nothing
// in it may appear in a call graph -- that is the property this fixture is
// here to hold the parser to.
//
// Java's `type-parameters` category has no type-only half: every Java generic
// declaration is a runtime class or interface. This is the first place the
// TypeScript corpus needs a distinction Java never had.
//
// Variance annotations (`in` / `out`) are the declaration-site counterpart to
// Java's use-site wildcards, and are the closest thing to a port of
// WildcardVariance.

// --- simple, multiple, and descriptive type parameters --------------------

export interface Container<T> {
    readonly value: T;
}

export interface Entry<K, V> {
    readonly key: K;
    readonly value: V;
}

export interface Selector<TState, TProps, TResult> {
    (state: TState, props: TProps): TResult;
}

// --- constrained type parameters ------------------------------------------

export interface Comparable<T> {
    compareTo(other: T): number;
}

export interface SortedCollection<T extends Comparable<T>> {
    readonly items: readonly T[];
    insert(item: T): SortedCollection<T>;
}

// --- intersection constraint (Java's `T extends A & B`) -------------------

export interface Serializable {
    serialize(): string;
}

export interface Cloneable<T> {
    clone(): T;
}

export interface Persistable<T extends Serializable & Cloneable<T>> {
    persist(entity: T): void;
}

// --- constraint referencing a sibling type parameter ----------------------

export interface Lens<TSource, TField extends keyof TSource> {
    get(source: TSource): TSource[TField];
    set(source: TSource, value: TSource[TField]): TSource;
}

// --- defaults, and constraint-plus-default --------------------------------

export interface Paginated<TRow, TCursor = string> {
    readonly rows: readonly TRow[];
    readonly cursor: TCursor | null;
}

export interface Reducer<TState, TAction extends { type: string } = { type: string }> {
    (state: TState, action: TAction): TState;
}

// --- variance annotations: covariant, contravariant, invariant ------------

export interface Producer<out T> {
    produce(): T;
}

export interface Consumer<in T> {
    consume(value: T): void;
}

export interface Channel<in out T> {
    send(value: T): void;
    receive(): T;
}

// --- type aliases with type parameters ------------------------------------

export type Nullable<T> = T | null;

export type Handler<TEvent, TResult = void> = (event: TEvent) => TResult;

export type Constructor<T, TArgs extends readonly unknown[] = readonly unknown[]> = new (
    ...args: TArgs
) => T;

export type AbstractConstructor<T> = abstract new (...args: never[]) => T;

// --- generic method signatures inside an interface ------------------------

export interface Visitor<TNode> {
    visit<TResult>(node: TNode, fold: (child: TNode) => TResult): TResult;
    visitAll<TResult, TSeed extends TResult>(nodes: readonly TNode[], seed: TSeed): TResult;
}

// --- F-bounded interface, the self type ----------------------------------

export interface Builder<TSelf extends Builder<TSelf, TResult>, TResult> {
    with(key: string, value: unknown): TSelf;
    build(): TResult;
}

// --- generic interface extending a generic interface ---------------------

export interface ReadOnlyStore<T extends { id: string }> extends Container<readonly T[]> {
    find(id: string): T | undefined;
}
