// fixture: blocks/control-flow
// nature: runtime-bearing
//
// Port of Java's `ControlFlowExamples.java` and the control-flow half of
// `NestedBlockLinking.java`: every block-introducing statement, and blocks
// nested inside one another to a depth of four.
//
// Java forms with no TypeScript analogue: the enhanced-for over an array is
// spelled `for...of`, and there is no `synchronized` block.
// TypeScript forms with no Java analogue: `for...in`, `for await...of`, and
// the fact that a block can also be introduced by an arrow-function body.
//
// `using` / `await using` blocks (TypeScript 5.2) are deliberately absent:
// they require "ESNext.Disposable" in `lib`, which the repo's root project
// does not set. See MANIFEST.md -- this is a blocked construct, not an
// oversight.

export interface Row {
    readonly id: string;
    readonly score: number;
}

const sink: string[] = [];

function emit(message: string): void {
    sink.push(message);
}

export function drain(): readonly string[] {
    return sink;
}

// --- if / else if / else -------------------------------------------------

export function classify(score: number): string {
    if (score < 0) {
        return "invalid";
    } else if (score < 50) {
        return "low";
    } else if (score < 80) {
        return "medium";
    } else {
        return "high";
    }
}

// --- if without a block (single statement, no braces) ------------------

export function guard(row: Row | undefined): string {
    if (row === undefined) return "none";
    if (row.score > 0) emit(row.id);
    return row.id;
}

// --- a bare block statement, introducing its own scope ----------------

export function bareBlock(): number {
    let total = 0;
    {
        const scoped = 10;
        total += scoped;
    }
    {
        const scoped = 20;
        total += scoped;
    }
    return total;
}

// --- while, and a while nested in a while -----------------------------

export function nestedWhile(limit: number): number {
    let outer = 0;
    let visited = 0;
    while (outer < limit) {
        let inner = 0;
        while (inner < outer) {
            visited++;
            inner++;
        }
        outer++;
    }
    return visited;
}

// --- do / while ---------------------------------------------------------

export function doWhile(limit: number): number {
    let count = 0;
    do {
        count++;
    } while (count < limit);
    return count;
}

// --- classic for: multiple initialisers, compound update -------------

export function classicFor(rows: readonly Row[]): number {
    let total = 0;
    for (let i = 0, length = rows.length; i < length; i++) {
        total += rows[i]?.score ?? 0;
    }
    return total;
}

// --- for with an externally declared variable and an empty header ------

export function externalCounter(limit: number): number {
    let i = 0;
    for (; i < limit; ) {
        i += 2;
    }
    return i;
}

// --- for with a comma-updated header and a boolean toggle -------------

export function toggling(limit: number): boolean {
    let flag = false;
    for (let i = 0, j = limit; i < j; i++, j--) {
        flag = !flag;
    }
    return flag;
}

// --- for...of over an array, a Map, and a destructured entry ----------

export function forOfForms(rows: readonly Row[], index: ReadonlyMap<string, Row>): number {
    let total = 0;
    for (const row of rows) {
        total += row.score;
    }
    for (const [key, row] of index) {
        emit(`${key}:${row.score}`);
    }
    for (const { id, score } of rows) {
        emit(`${id}=${score}`);
    }
    return total;
}

// --- for...in over an object's keys -----------------------------------

export function forInForm(source: Record<string, number>): number {
    let total = 0;
    for (const key in source) {
        if (Object.hasOwn(source, key)) {
            total += source[key] ?? 0;
        }
    }
    return total;
}

// --- for await...of, inside an async function -------------------------

export async function forAwaitOf(pages: AsyncIterable<readonly Row[]>): Promise<number> {
    let total = 0;
    for await (const page of pages) {
        for (const row of page) {
            total += row.score;
        }
    }
    return total;
}

// --- switch: grouped cases, default, and a switch on a string --------

export function switchForms(kind: string): number {
    switch (kind) {
        case "a":
        case "b":
            return 1;
        case "c": {
            // a case with its own block scope
            const bonus = 2;
            return bonus;
        }
        default:
            return 0;
    }
}

// --- a switch nested inside a loop, with break and continue ----------

export function switchInLoop(kinds: readonly string[]): number {
    let total = 0;
    for (const kind of kinds) {
        switch (kind) {
            case "skip":
                continue;
            case "stop":
                return total;
            default:
                total++;
        }
    }
    return total;
}

// --- labelled statements, with labelled break and continue ----------

export function labelled(grid: readonly (readonly number[])[]): number {
    let found = -1;
    outer: for (let i = 0; i < grid.length; i++) {
        const row = grid[i];
        if (row === undefined) {
            continue outer;
        }
        inner: for (let j = 0; j < row.length; j++) {
            if (row[j] === 0) {
                continue inner;
            }
            if ((row[j] ?? 0) > 100) {
                found = i;
                break outer;
            }
        }
    }
    return found;
}

// --- a labelled bare block, broken out of --------------------------

export function labelledBlock(value: number): string {
    let result = "unset";
    block: {
        if (value < 0) {
            result = "negative";
            break block;
        }
        result = "non-negative";
    }
    return result;
}

// --- four levels of nesting: if > for > while > if ------------------

export function deeplyNested(n: number): number {
    let hits = 0;
    if (n > 0) {
        for (let i = 0; i < n; i++) {
            let j = 0;
            while (j < 5) {
                if (j === 2) {
                    hits++;
                    break;
                }
                j++;
            }
        }
    } else {
        emit("non-positive");
    }
    return hits;
}

// --- blocks introduced by function bodies nested in loops ----------

export function blocksInsideCallbacks(rows: readonly Row[]): number {
    let total = 0;
    rows.forEach((row) => {
        // arrow-function body block, nested inside a call, inside a method
        if (row.score > 0) {
            for (let i = 0; i < row.score; i++) {
                total += 1;
            }
        }
    });
    return total;
}

// --- a loop inside an immediately-invoked function expression ------

export const iifeLoop: number = (function (): number {
    let total = 0;
    for (let i = 0; i < 3; i++) {
        total += i;
    }
    return total;
})();
