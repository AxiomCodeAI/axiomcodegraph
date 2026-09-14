// fixture: type-registry/type-placement
// nature: runtime-bearing
//
// Where a type declaration may physically sit. This is the port of Java's
// `test-type-placement.java`, and it is the category where the two languages
// diverge most: TypeScript has no inner classes and no static nested classes.
// A class is either a module-level declaration, a local declaration inside a
// function or block body, or a value held by a property. Nesting a *type* is
// done with a namespace, which is deferred to half two by assignment.
//
// Modelled on the factory/closure patterns that appear throughout real
// TypeScript: a local class captured by a closure, and a class attached to a
// static property to namespace it.

// --- top level, exported ---------------------------------------------------

export class Lexer {
    constructor(readonly text: string) {}

    tokenCount(): number {
        return this.text.split(/\s+/).filter(Boolean).length;
    }
}

// --- top level, not exported ----------------------------------------------

interface ParserState {
    position: number;
    tokens: readonly string[];
}

// --- a class declared inside a function body (a local class) --------------

export function createCountingLexer(prefix: string) {
    // local class: its scope is the function body, and it closes over `prefix`
    class CountingLexer extends Lexer {
        static created = 0;

        constructor(text: string) {
            super(`${prefix}${text}`);
            CountingLexer.created++;
        }

        override tokenCount(): number {
            return super.tokenCount();
        }
    }

    return CountingLexer;
}

// --- an interface and an enum declared inside a function body -------------

export function parse(text: string): number {
    interface LocalFrame {
        depth: number;
        state: ParserState;
    }

    enum LocalMode {
        Scanning,
        Done,
    }

    const frame: LocalFrame = {
        depth: 0,
        state: { position: 0, tokens: text.split(" ") },
    };

    let mode: LocalMode = LocalMode.Scanning;
    while (mode === LocalMode.Scanning) {
        frame.depth++;
        mode = LocalMode.Done;
    }

    return frame.state.tokens.length;
}

// --- a class declared inside a block statement ----------------------------

export function scopedDeclaration(enabled: boolean): string {
    if (enabled) {
        class BlockScoped {
            readonly kind = "block-scoped";
        }
        return new BlockScoped().kind;
    }
    return "disabled";
}

// --- a class held on a static property: the nearest thing TypeScript has to
//     a static nested class, and a shape that occurs in real library code ---

export class Compiler {
    static readonly Diagnostics = class {
        readonly messages: string[] = [];

        add(message: string): void {
            this.messages.push(message);
        }
    };

    readonly diagnostics = new Compiler.Diagnostics();
}

// --- a class expression inside an object literal --------------------------

export const factories = {
    lexer: class InlineLexer extends Lexer {},
    make(text: string): Lexer {
        return new factories.lexer(text);
    },
};

// --- default export at the end of the module ------------------------------

export default class CompilerHostImpl {
    constructor(private readonly currentDirectory: string) {}

    getCurrentDirectory(): string {
        return this.currentDirectory;
    }
}
