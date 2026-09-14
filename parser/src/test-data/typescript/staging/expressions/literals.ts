// fixture: expressions/literals
// nature: runtime-bearing
//
// Port of Java's `LiteralTypeTestCases.java`. Every literal form in the
// language, at the precision a lexer has to get right.
//
// Java literal forms with no TypeScript analogue: char literals ('x'), the
// float/long/double suffixes (1.5f, 999L, 3d), and octal-by-leading-zero.
// TypeScript forms with no Java analogue: template literals, tagged
// templates, regular-expression literals, `undefined`, bigint, symbols, and
// object/array literals as first-class expressions.

const sink: unknown[] = [];

function use(...values: unknown[]): void {
    sink.push(...values);
}

export function drain(): readonly unknown[] {
    return sink;
}

// --- numeric literals ----------------------------------------------------

export function numericLiterals(): void {
    const decimal = 42;
    const negative = -17;
    const zero = 0;
    const float = 3.14;
    const leadingDot = 0.5;
    const trailingDot = 5.0;
    const exponent = 1e10;
    const negativeExponent = 1.5e-8;
    const positiveExponent = 2e+3;
    const hex = 0xff;
    const hexUpper = 0XDEADBEEF;
    const octal = 0o755;
    const binary = 0b1010_0001;
    const separators = 1_000_000;
    const floatSeparators = 1_234.567_8;
    const maxSafe = 9007199254740991;

    use(decimal, negative, zero, float, leadingDot, trailingDot);
    use(exponent, negativeExponent, positiveExponent);
    use(hex, hexUpper, octal, binary, separators, floatSeparators, maxSafe);
}

// --- bigint literals (no Java equivalent) -------------------------------

export function bigintLiterals(): void {
    const big = 9007199254740993n;
    const bigHex = 0xffff_ffff_ffff_ffffn;
    const bigZero = 0n;
    const bigNegative = -1n;
    use(big, bigHex, bigZero, bigNegative);
}

// --- string literals, both quote styles and every escape ---------------

export function stringLiterals(): void {
    const double = "double quoted";
    const single = 'single quoted';
    const withEscapedQuote = "she said \"hello\"";
    const withApostrophe = 'it\'s here';
    const escapes = "tab\there\nnewline\r\ncarriage\\backslash\0null";
    const unicodeEscape = "Aé";
    const unicodeCodePoint = "\u{1F600}";
    const hexEscape = "\x41";
    const emoji = "🎯 surrogate pair";
    const empty = "";

    use(double, single, withEscapedQuote, withApostrophe, escapes);
    use(unicodeEscape, unicodeCodePoint, hexEscape, emoji, empty);
}

// --- template literals ---------------------------------------------------

export function templateLiterals(name: string, count: number): void {
    const plain = `no substitution`;
    const single = `hello ${name}`;
    const multiple = `${name} has ${count} items`;
    const expression = `total: ${count * 2 + 1}`;
    const nestedTemplate = `outer ${`inner ${name}`} end`;
    const multiline = `line one
line two
line three`;
    const withCall = `upper: ${name.toUpperCase()}`;
    const withTernary = `${count > 0 ? `many ${count}` : "none"}`;
    const escapedBacktick = `a \` backtick and a \${ non-substitution`;

    use(plain, single, multiple, expression, nestedTemplate);
    use(multiline, withCall, withTernary, escapedBacktick);
}

// --- tagged templates ----------------------------------------------------

function sql(strings: TemplateStringsArray, ...values: readonly unknown[]): string {
    return strings.raw.join("?") + values.length;
}

const tags = {
    html(strings: TemplateStringsArray, ...values: readonly unknown[]): string {
        return strings.join("") + values.length;
    },
};

export function taggedTemplates(table: string, id: number): void {
    const query = sql`SELECT * FROM ${table} WHERE id = ${id}`;
    const bare = sql`SELECT 1`;
    const qualified = tags.html`<p>${table}</p>`;
    const nestedTag = sql`outer ${sql`inner ${id}`}`;
    use(query, bare, qualified, nestedTag);
}

// --- regular-expression literals ----------------------------------------

export function regexLiterals(input: string): void {
    const simple = /abc/;
    const withFlags = /^[a-z]+$/gi;
    const allFlags = /x/gimsuy;
    const escaped = /\d+\.\d+/;
    const withSlash = /https:\/\//;
    const characterClass = /[^\s"'<>]+/g;
    const namedGroup = /(?<year>\d{4})-(?<month>\d{2})/u;
    const lookahead = /foo(?=bar)/;

    use(simple.test(input), withFlags.source, allFlags.flags, escaped.exec(input));
    use(withSlash, characterClass, namedGroup, lookahead);
}

// --- keyword literals ----------------------------------------------------

export function keywordLiterals(): void {
    const yes = true;
    const no = false;
    const nothing = null;
    const missing = undefined;
    use(yes, no, nothing, missing);
}

// --- object literals -----------------------------------------------------

const computedKey = "dynamic";

export function objectLiterals(name: string, extra: Record<string, number>): void {
    const empty = {};
    const simple = { id: 1, name: "row" };

    // shorthand property
    const shorthand = { name };

    // computed keys, from a const and from an expression
    const computed = { [computedKey]: 1, [`${name}-key`]: 2, [1 + 1]: 3 };

    // quoted and numeric keys
    const quoted = { "with space": 1, "kebab-case": 2, 42: "numeric", 0.5: "float" };

    // methods, getters and setters in a literal
    const withMembers = {
        _value: 0,
        method(): number {
            return this._value;
        },
        get value(): number {
            return this._value;
        },
        set value(next: number) {
            this._value = next;
        },
    };

    // spread, and spread combined with overrides
    const spread = { ...simple, ...extra, id: 99 };

    // nested literals
    const nested = { outer: { middle: { inner: [1, { deep: true }] } } };

    use(empty, simple, shorthand, computed, quoted, withMembers.value, spread, nested);
}

// --- array literals ------------------------------------------------------

export function arrayLiterals(values: readonly number[]): void {
    const empty: number[] = [];
    const simple = [1, 2, 3];
    const mixed: Array<string | number | boolean | null> = ["a", 1, true, null];
    const nested = [[1, 2], [3, 4], []];
    const spread = [0, ...values, 99];
    const trailingComma = [1, 2, 3,];
    const sparse = [1, , 3]; // a hole: index 1 is absent, not undefined
    const ofObjects = [{ id: 1 }, { id: 2 }];

    use(empty, simple, mixed, nested, spread, trailingComma, sparse, ofObjects);
}

// --- symbols -------------------------------------------------------------

export function symbolLiterals(): void {
    const unique = Symbol("description");
    const shared = Symbol.for("app.key");
    const wellKnown = Symbol.iterator;
    const keyed = { [unique]: 1, [wellKnown]: function* () { yield 1; } };
    use(unique.description, shared, keyed);
}
