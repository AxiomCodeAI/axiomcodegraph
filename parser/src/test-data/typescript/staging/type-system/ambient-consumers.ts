// fixture: type-system/ambient-consumers
// nature: runtime-bearing
//
// The runtime counterpart to ambient-declarations.ts: call sites whose targets
// are AMBIENT. Each call below is real and emitted, and none of them can link
// to a definition, because no definition exists in the corpus.
//
// This is the shape the closed-world check must classify as "ambient" rather
// than "unresolved". Keeping these calls in their own file, separate from the
// declarations, means the distinction is measurable.

declare const runtimeConfig: { readonly apiKey: string; readonly debug: boolean };

declare function externalLog(message: string, level?: number): void;

declare function externalParse(raw: string): string;
declare function externalParse(raw: string, radix: number): number;

declare class ExternalMetrics {
    constructor(namespace: string);
    increment(name: string, by?: number): void;
    static global(): ExternalMetrics;
}

declare namespace ExternalTelemetry {
    function span<T>(name: string, body: () => T): T;
}

// --- calls to ambient functions -------------------------------------

export function callAmbientFunction(message: string): void {
    externalLog(message);
    externalLog(message, 2);
}

// --- a call resolving to one of two ambient overloads -------------

export function callAmbientOverload(raw: string): string | number {
    const asString = externalParse(raw);
    const asNumber = externalParse(raw, 10);
    return asString.length > 0 ? asString : asNumber;
}

// --- construction and method calls on an ambient class ------------

export function useAmbientClass(): void {
    const metrics = new ExternalMetrics("app");
    metrics.increment("requests");
    metrics.increment("requests", 5);
    ExternalMetrics.global().increment("global");
}

// --- a call through an ambient namespace -------------------------

export function useAmbientNamespace(): number {
    return ExternalTelemetry.span("work", () => 42);
}

// --- reading an ambient value ------------------------------------

export function readAmbientValue(): string {
    return runtimeConfig.debug ? runtimeConfig.apiKey : "";
}

// --- an ambient target passed as a callback, not called here ----

export function passAmbientReference(): (message: string, level?: number) => void {
    return externalLog;
}
