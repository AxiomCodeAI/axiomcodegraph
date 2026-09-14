// fixture: expressions/operators
// nature: runtime-bearing
//
// Port of Java's `AssignmentExpressionExamples.java`, `CastExpressionExamples.java`
// and the operator half of `ExpressionStatementTests.java`.
//
// Java operators with no TypeScript analogue: none of consequence -- the
// operator sets line up almost exactly, which is why this category ports more
// cleanly than any other.
// TypeScript operators with no Java analogue: `??`, `?.`, `??=`, `&&=`, `||=`,
// `**`, `typeof`, `void`, `delete`, `in`, spread, and the non-null assertion
// `!`, which is erased and therefore must never become a runtime edge.

const sink: unknown[] = [];

function use(...values: unknown[]): void {
    sink.push(...values);
}

export function drain(): readonly unknown[] {
    return sink;
}

// --- arithmetic ----------------------------------------------------------

export function arithmetic(a: number, b: number): void {
    use(a + b, a - b, a * b, a / b, a % b, a ** b);
    use((a + b) * (a - b), a + b * a, -a, +b);
}

// --- string concatenation, the overloaded `+` ---------------------------

export function concatenation(name: string, count: number): void {
    use(name + "!", "count: " + count, name + count + name);
}

// --- comparison and equality --------------------------------------------

export function comparison(a: number, b: number, x: unknown, y: unknown): void {
    use(a < b, a <= b, a > b, a >= b);
    use(a === b, a !== b);
    // loose equality: coerces, and is a distinct operator from ===
    use(x == y, x != y);
    use(x == null); // the idiomatic null-or-undefined check
}

// --- logical, including short-circuit and nullish coalescing -----------

export function logical(a: boolean, b: boolean, maybe: string | null | undefined): void {
    use(a && b, a || b, !a, !!maybe);
    use(a && b && !a);
    // ?? falls back only on null/undefined; || falls back on any falsy value
    use(maybe ?? "fallback", maybe || "fallback");
    use((maybe ?? "a") + (a ? "b" : "c"));
}

// --- bitwise and shifts ---------------------------------------------------

export function bitwise(flags: number, mask: number): void {
    use(flags & mask, flags | mask, flags ^ mask, ~flags);
    use(flags << 2, flags >> 2, flags >>> 2); // >>> is unsigned right shift
    use((flags & ~mask) >>> 0);
}

// --- assignment and every compound assignment --------------------------

export function assignments(start: number): number {
    let value = start;
    value += 1;
    value -= 2;
    value *= 3;
    value /= 4;
    value %= 5;
    value **= 2;
    value <<= 1;
    value >>= 1;
    value >>>= 1;
    value &= 0xff;
    value |= 0x0f;
    value ^= 0xf0;
    return value;
}

// --- logical assignment operators ---------------------------------------

export function logicalAssignments(input: {
    name?: string;
    count?: number;
    enabled?: boolean;
}): void {
    const target = { ...input };
    target.name ??= "default"; // assigns only if null/undefined
    target.count ||= 10; // assigns if falsy
    target.enabled &&= false; // assigns only if truthy
    use(target);
}

// --- chained assignment, and assignment as an expression --------------

export function assignmentAsExpression(): number {
    let a: number;
    let b: number;
    let c: number;
    a = b = c = 5; // chained, right-associative
    let total = 0;
    // an assignment used for its value inside a condition
    let next: number;
    while ((next = a - 1) > 0) {
        total += next;
        a = next;
    }
    use(b, c);
    return total;
}

// --- increment and decrement, prefix and postfix ---------------------

export function incrementDecrement(): number {
    let i = 0;
    const postIncrement = i++; // yields the old value
    const preIncrement = ++i; // yields the new value
    const postDecrement = i--;
    const preDecrement = --i;
    use(postIncrement, preIncrement, postDecrement, preDecrement);
    return i;
}

// --- ternary, including nesting -----------------------------------------

export function ternary(score: number): string {
    const simple = score > 0 ? "positive" : "non-positive";
    const nested = score > 100 ? "high" : score > 50 ? "medium" : score > 0 ? "low" : "zero";
    const inTemplate = `${score > 0 ? "+" : "-"}${Math.abs(score)}`;
    use(simple, nested, inTemplate);
    return nested;
}

// --- typeof, void, delete, in, instanceof -----------------------------

export class Handle {
    readonly id = 1;
}

export function unaryAndRelational(value: unknown, handle: Handle | Error): void {
    use(typeof value, typeof value === "string", typeof undefined);
    use(void 0);

    const target: { removable?: number; kept: number } = { removable: 1, kept: 2 };
    delete target.removable;
    use(target);

    use("kept" in target, "removable" in target);
    use(handle instanceof Handle, handle instanceof Error);
}

// --- the comma operator ---------------------------------------------------

export function commaOperator(): number {
    let a = 1;
    // both sides evaluate; the expression takes the value of the last
    const result = (a += 1, a * 2);
    return result;
}

// --- spread in calls and literals ---------------------------------------

export function spreadForms(values: readonly number[], extra: Record<string, number>): void {
    const merged = [...values, ...values];
    const object = { ...extra, added: 1 };
    const called = Math.max(...values, 0);
    use(merged, object, called);
}

// --- the non-null assertion: erased, never a runtime operation --------

export function nonNullAssertion(rows: readonly string[] | undefined): string {
    const first = rows![0]!;
    return first;
}

// --- `as` type assertions: also erased ---------------------------------

export function typeAssertions(raw: unknown): number {
    const asNumber = raw as number;
    const doubleAssertion = raw as unknown as Handle;
    // the angle-bracket form is illegal in .tsx but legal here
    const angleBracket = <number>raw;
    use(doubleAssertion.id, angleBracket);
    return asNumber;
}

// --- operator precedence made explicit by parentheses ------------------

export function precedence(a: number, b: number, c: boolean): number {
    const withoutParens = a + b * 2 - a / 2;
    const withParens = ((a + b) * 2 - a) / 2;
    const mixedLogical = (c && a > b) || (!c && a < b) ? a : b;
    use(withoutParens, mixedLogical);
    return withParens;
}

// --- await and yield as expressions ------------------------------------

export async function awaitExpression(load: () => Promise<number>): Promise<number> {
    const value = await load();
    const combined = (await load()) + value;
    return combined;
}

export function* yieldExpressions(values: readonly number[]): Generator<number, string, number> {
    const received: number = yield values[0] ?? 0;
    yield* values; // delegating yield
    return `done:${received}`;
}
