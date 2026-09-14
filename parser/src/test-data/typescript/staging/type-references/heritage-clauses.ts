// fixture: type-references/heritage-clauses
// nature: runtime-bearing
//
// Every heritage position a type reference can occupy: `extends` on a class,
// `implements` on a class (single and multiple), `extends` on an interface
// (single and multiple), and `extends` applied to an expression, which is how
// mixins are written in real TypeScript and which Java has no form of.
//
// Port of Java's `test-superclass-refs.java`, `test-interface-refs.java` and
// `test-permits-refs.java`. Two Java constructs do not survive the crossing:
//   - `permits` / sealed hierarchies: no analogue (MANIFEST.md)
//   - a class may implement an interface it never names -- structural
//     satisfaction -- which is half two's territory and is deliberately NOT
//     exercised here, so that this file stays a faithful port of the Java
//     nominal model and half two can show it breaking.

// --- the interfaces being referenced --------------------------------------

export interface Disposable {
    dispose(): void;
}

export interface Serializable {
    serialize(): string;
}

export interface Comparable<T> {
    compareTo(other: T): number;
}

export interface Named {
    readonly name: string;
}

// --- interface extends one interface --------------------------------------

export interface NamedDisposable extends Disposable {
    readonly label: string;
}

// --- interface extends several interfaces ---------------------------------

export interface Resource extends Disposable, Serializable, Named {
    readonly handle: number;
}

// --- interface extends a generic interface with a concrete argument -------

export interface StringComparable extends Comparable<string> {
    readonly collation: string;
}

// --- interface extends a generic interface with a nested argument --------

export interface ListComparable extends Comparable<readonly string[]> {}

// --- a plain base class and a plain subclass ------------------------------

export class Node {
    constructor(readonly kind: string) {}
}

export class Identifier extends Node {
    constructor(readonly text: string) {
        super("Identifier");
    }
}

// --- extends a generic base with a concrete type argument ----------------

export class Collection<T> {
    protected readonly items: T[] = [];

    add(item: T): void {
        this.items.push(item);
    }

    size(): number {
        return this.items.length;
    }
}

export class StringCollection extends Collection<string> {
    join(separator: string): string {
        return this.items.join(separator);
    }
}

// --- extends a generic base with a nested type argument ------------------

export class MatrixCollection extends Collection<readonly number[][]> {}

// --- a generic subclass forwarding its own parameter to the base ---------

export class TypedCollection<T> extends Collection<T> {
    first(): T | undefined {
        return this.items[0];
    }
}

// --- implements one interface ---------------------------------------------

export class FileHandle implements Disposable {
    constructor(readonly path: string) {}

    dispose(): void {
        // releases the handle
    }
}

// --- implements several interfaces ---------------------------------------

export class Document implements Disposable, Serializable, Named {
    constructor(readonly name: string) {}

    dispose(): void {}

    serialize(): string {
        return this.name;
    }
}

// --- implements a generic interface ---------------------------------------

export class Version implements Comparable<Version>, Serializable {
    constructor(
        readonly major: number,
        readonly minor: number,
    ) {}

    compareTo(other: Version): number {
        return this.major - other.major || this.minor - other.minor;
    }

    serialize(): string {
        return `${this.major}.${this.minor}`;
    }
}

// --- extends AND implements on one declaration ---------------------------

export class SerializableIdentifier extends Identifier implements Serializable, Named {
    get name(): string {
        return this.text;
    }

    serialize(): string {
        return this.text;
    }
}

// --- abstract base, concrete subclass -------------------------------------

export abstract class AbstractVisitor<TResult> {
    abstract visitIdentifier(node: Identifier): TResult;

    visit(node: Node): TResult | undefined {
        return node instanceof Identifier ? this.visitIdentifier(node) : undefined;
    }
}

export class TextVisitor extends AbstractVisitor<string> {
    visitIdentifier(node: Identifier): string {
        return node.text;
    }
}

// --- `extends` applied to an expression: the mixin pattern ---------------
//     (a heritage clause whose operand is a call, not a name)

type Ctor<T = {}> = new (...args: any[]) => T;

export function WithTimestamp<TBase extends Ctor>(Base: TBase) {
    return class extends Base {
        readonly createdAt = Date.now();
    };
}

export class Entity {
    constructor(readonly id: string) {}
}

export class TimestampedEntity extends WithTimestamp(Entity) implements Named {
    get name(): string {
        return this.id;
    }
}
