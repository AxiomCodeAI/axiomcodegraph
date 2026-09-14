// fixture: type-system/ambient-declarations
// nature: type-only
//
// `declare` asserts that something exists without defining it. Every
// declaration here is erased: an ambient file describes a runtime it does not
// contain. This is the typeshed analogue, except it ships inside packages and
// is therefore always present.
//
// A call to an ambient function is a real call site with no definition to link
// to -- "ambient" is precisely the closed-world escape hatch, so the corpus
// needs the shapes that produce it.

// --- ambient variables --------------------------------------------------

declare const BUILD_ID: string;
declare let mutableAmbient: number;
declare var legacyGlobal: { readonly version: string } | undefined;

// --- ambient functions, including an overload set ---------------------

declare function fetchJson(url: string): Promise<unknown>;
declare function parseValue(raw: string): string;
declare function parseValue(raw: string, radix: number): number;

// --- ambient class: signatures only, no bodies anywhere -------------

declare class ExternalClient {
    readonly endpoint: string;
    constructor(endpoint: string);
    request(path: string): Promise<string>;
    static create(endpoint: string): ExternalClient;
    protected retry(): void;
}

// --- ambient enum, and a declared const enum ------------------------

declare enum ExternalLevel {
    Low,
    High,
}

// --- ambient namespace, with nested members -------------------------

declare namespace ExternalSdk {
    interface Options {
        readonly apiKey: string;
        readonly region?: string;
    }

    class Session {
        readonly token: string;
        refresh(): Promise<void>;
    }

    function init(options: Options): Session;

    namespace Internal {
        const buildTag: string;
    }
}

// NOTE: ambient MODULE declarations (`declare module "pkg"`) cannot live in a
// module file -- there they are read as augmentations of an existing module.
// They are in ambient-module.d.ts, which is where real projects put them.

// --- consumption in TYPE position only, so nothing here emits -----

export type ClientType = ExternalClient;
export type SdkOptions = ExternalSdk.Options;
export type SdkSession = ExternalSdk.Session;
export type BuildId = typeof BUILD_ID;
export type Fetcher = typeof fetchJson;
export type Level = ExternalLevel;
export type LegacyGlobal = typeof legacyGlobal;
export type Mutable = typeof mutableAmbient;
export type ParseValue = typeof parseValue;
export type InternalTag = typeof ExternalSdk.Internal.buildTag;
