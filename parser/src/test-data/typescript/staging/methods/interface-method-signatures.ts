// fixture: methods/interface-method-signatures
// nature: type-only
//
// The type-only half of the `methods` category: method members that declare a
// signature and can never have a body. Java's interface methods can have
// bodies (`default`) and can be `static`; TypeScript interface members can be
// neither, so Java's MethodKind.DEFAULT and static-interface-method have no
// port. See MANIFEST.md.
//
// Nothing here is emitted. A call-graph row sourced from this file is a bug.
//
// Shaped after real declaration files: a visitor, a host interface in the
// style of ts.CompilerHost, and a promise-returning client.

export interface Diagnostic {
    readonly code: number;
    readonly message: string;
}

// --- method signatures, optional members, and readonly function props ----

export interface CompilerHost {
    // plain method signature
    getSourceFile(fileName: string, languageVersion: number): string | undefined;

    // optional method signature
    resolveModuleNames?(moduleNames: readonly string[], containingFile: string): string[];

    // property whose type is a function type (not a method signature --
    // the two differ in how strictly parameters are checked)
    readonly writeFile: (fileName: string, text: string) => void;

    // readonly data members
    readonly useCaseSensitiveFileNames: boolean;
    readonly newLine: string;

    // getter-style member: an interface can only declare the property
    readonly currentDirectory: string;
}

// --- call signature and construct signature ------------------------------

export interface DiagnosticFactory {
    // call signature: the interface itself is callable
    (code: number, message: string): Diagnostic;

    // construct signature: the interface is newable
    new (code: number): Diagnostic;

    // a static-side member sitting alongside them
    readonly defaultCode: number;
}

// --- index signatures, string and number keyed --------------------------

export interface DiagnosticIndex {
    [code: number]: Diagnostic;
}

export interface MessageCatalogue {
    readonly [key: string]: string | undefined;
}

// --- generic method signatures, including a constrained one -------------

export interface Visitor<TNode> {
    visit<TResult>(node: TNode): TResult | undefined;
    reduce<TResult, TSeed extends TResult>(nodes: readonly TNode[], seed: TSeed): TResult;
    forEachChild<TNode2 extends TNode>(node: TNode2, cb: (child: TNode2) => void): void;
}

// --- overloaded method signatures inside an interface -------------------

export interface Store {
    read(key: string): string | undefined;
    read(key: string, fallback: string): string;
    write(key: string, value: string): void;
    write(entries: ReadonlyMap<string, string>): void;
}

// --- async, iterable and generator-shaped signatures --------------------

export interface AsyncClient {
    fetch(url: string): Promise<string>;
    stream(url: string): AsyncIterable<string>;
    entries(): IterableIterator<readonly [string, string]>;
    [Symbol.iterator](): Iterator<string>;
    [Symbol.asyncIterator](): AsyncIterator<string>;
}

// --- a `this` type in a signature, for fluent interfaces ---------------

export interface Chainable {
    where(predicate: string): this;
    limit(count: number): this;
}

// --- type predicate and assertion signatures in an interface -----------

export interface Guards {
    isDiagnostic(value: unknown): value is Diagnostic;
    assertDiagnostic(value: unknown): asserts value is Diagnostic;
}

// --- the same member set expressed as a type alias with an object type --

export type CompilerHostLike = {
    getSourceFile(fileName: string): string | undefined;
    readonly writeFile: (fileName: string, text: string) => void;
    new (): CompilerHostLike;
};

// --- a function-type alias with an overloaded call signature -----------

export type Overloaded = {
    (value: string): string;
    (value: number): number;
};
