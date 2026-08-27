// fixture: type-system/structural/assignable-without-syntax
// nature: runtime-bearing
//
// The harder half of structural typing: assignable pairs that exist in NO
// SYNTAX AT ALL. There is no `implements`, no `extends`, no import linking the
// two sides -- the relation exists only because the checker computed it.
// ts-oracle measured 21.5% of assignable pairs in this category.
//
// A syntax-directed extractor cannot recover any of these. That is not a bug
// in the extractor; it is the boundary of what syntax can express, and the
// corpus should state where that boundary falls rather than imply the pairs
// are absent.

// --- two classes with no relationship, mutually assignable ----------

export class Point2D {
    constructor(
        readonly x: number,
        readonly y: number,
    ) {}
}

export class Vector2 {
    constructor(
        readonly x: number,
        readonly y: number,
    ) {}
}

export function mutuallyAssignable(): number {
    // neither class names the other, and neither shares a base
    const asVector: Vector2 = new Point2D(1, 2);
    const asPoint: Point2D = new Vector2(3, 4);
    return asVector.x + asPoint.y;
}

// --- a class assignable to a type alias declared independently -----

export type Coordinates = { readonly x: number; readonly y: number };

export function classToAlias(): number {
    const coords: Coordinates = new Point2D(5, 6);
    return coords.x;
}

// --- an object literal assignable to a class TYPE, with no `new` --

export function literalToClass(): number {
    // structurally a Point2D, but never constructed as one
    const impostor: Point2D = { x: 7, y: 8 };
    return impostor.x;
}

// --- a subtype relation between two unrelated INTERFACES ---------

export interface HasId {
    readonly id: string;
}

export interface HasIdAndName {
    readonly id: string;
    readonly name: string;
}

export function interfaceSubtyping(full: HasIdAndName): string {
    // HasIdAndName is assignable to HasId, though it does not extend it
    const partial: HasId = full;
    return partial.id;
}

// --- function assignability: fewer parameters, and return covariance

export type Callback = (value: string, index: number) => string | number;

export function functionAssignability(): unknown {
    // a function of ONE parameter is assignable to a two-parameter type
    const fewer: Callback = (value: string) => value;
    // a function of ZERO parameters likewise
    const none: Callback = () => 0;
    // narrower return type: covariant, so assignable
    const narrowReturn: Callback = (value: string, index: number) => `${value}${index}`;
    // wider parameter type: contravariant, so assignable
    const widerParam: Callback = (value: unknown, index: number) => String(value) + index;
    return [fewer("a", 0), none("b", 1), narrowReturn("c", 2), widerParam("d", 3)];
}

// --- method-parameter BIVARIANCE vs function-property CONTRAVARIANCE
//     the same-looking members behave differently under strictFunctionTypes

export interface WithMethod {
    handle(event: { readonly kind: string }): void;
}

export interface WithProperty {
    handle: (event: { readonly kind: string }) => void;
}

export class MethodHandler {
    // narrower parameter: accepted, because METHOD parameters are bivariant
    handle(event: { readonly kind: string; readonly extra: number }): void {
        void event;
    }
}

export function bivariance(): WithMethod {
    return new MethodHandler();
}

// --- readonly and mutable arrays: assignable one way only --------

export function arrayVariance(mutable: string[], frozen: readonly string[]): number {
    const toReadonly: readonly string[] = mutable; // widening, allowed
    void frozen;
    return toReadonly.length;
}

// --- structural satisfaction across a generic instantiation -----

export interface Container<T> {
    readonly items: readonly T[];
}

export class Bag {
    readonly items: readonly string[] = ["a"];
}

export function genericStructural(): number {
    const container: Container<string> = new Bag();
    return container.items.length;
}

// --- where structural typing STOPS: #private makes a class nominal

export class Branded {
    #brand = "branded";

    constructor(readonly value: string) {}

    read(): string {
        return this.#brand + this.value;
    }
}

export class LooksIdentical {
    #brand = "branded";

    constructor(readonly value: string) {}

    read(): string {
        return this.#brand + this.value;
    }
}

export function privateFieldsAreNominal(a: Branded, b: LooksIdentical): string {
    // these two classes are NOT assignable to each other despite identical
    // shape: a #private field is nominal, and each declaration is distinct
    return a.read() + b.read();
}

// --- the same nominality achieved by a branded type -------------

declare const brand: unique symbol;
export type UserId = string & { readonly [brand]: "UserId" };
export type OrderId = string & { readonly [brand]: "OrderId" };

export function makeUserId(raw: string): UserId {
    return raw as UserId;
}

export function useBrands(id: UserId): string {
    // UserId and OrderId are both strings and neither is assignable to the
    // other -- structural typing deliberately defeated
    return id;
}

// --- excess property checks: a FRESH literal is checked more
//     strictly than a variable of the same type ----------------

export interface Options {
    readonly retries?: number;
    readonly timeoutMs?: number;
}

export function excessProperties(): number {
    const viaVariable = { retries: 1, unknownOption: true };
    // assignable: freshness is lost once it is a variable
    const options: Options = viaVariable;
    return options.retries ?? 0;
}
