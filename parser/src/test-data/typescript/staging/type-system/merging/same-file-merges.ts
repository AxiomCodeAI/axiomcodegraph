// fixture: type-system/merging/same-file-merges
// nature: runtime-bearing
//
// Declaration merging breaks `name -> single entity`. One name can have many
// declarations that the checker folds into one symbol, and neither Java nor
// Python has anything comparable: in both, a redeclaration is an error.
//
// ts-oracle measured 1,986 multi-declaration symbols in real TypeScript, the
// largest with 43 declarations. Any primary key of the form (file, name) is
// therefore wrong before the first row is written.
//
// This file covers every merge that happens WITHIN one file. Cross-file merges
// are in two-files/, three-files/ and module-augmentation.ts.

// --- interface + interface: members union ---------------------------

export interface Config {
    readonly name: string;
}

export interface Config {
    readonly retries: number;
}

export interface Config {
    readonly nested: { readonly deep: boolean };
}

// one symbol, three declarations, all members visible
export const config: Config = { name: "a", retries: 1, nested: { deep: true } };

// --- interface merging that ADDS an overload to a method -----------

export interface Store {
    read(key: string): string | undefined;
}

export interface Store {
    read(key: string, fallback: string): string;
    write(key: string, value: string): void;
}

// --- namespace + function: the callable-with-properties idiom ------

export function createId(seed: number): string {
    return `${createId.prefix}${seed}`;
}

export namespace createId {
    export const prefix = "id-";
    export function reset(): void {
        counter = 0;
    }
    export let counter = 0;
}

// --- namespace + class: static members added by a namespace -------

export class Album {
    constructor(readonly title: string) {}
}

export namespace Album {
    export const maxTracks = 24;
    export interface Track {
        readonly title: string;
        readonly seconds: number;
    }
    export function empty(): Album {
        return new Album("");
    }
}

// the namespace half contributes a TYPE reachable through the class name
export const track: Album.Track = { title: "t", seconds: 100 };

// --- namespace + enum: computed members alongside declared ones ---

export enum Colour {
    Red = "red",
    Green = "green",
}

export namespace Colour {
    export function parse(value: string): Colour | undefined {
        return value === "red" ? Colour.Red : value === "green" ? Colour.Green : undefined;
    }
}

// --- namespace + namespace: merged, with a shared inner scope ----

export namespace Validation {
    export interface Validator {
        check(value: string): boolean;
    }
}

export namespace Validation {
    export class LengthValidator implements Validator {
        constructor(readonly min: number) {}
        check(value: string): boolean {
            return value.length >= this.min;
        }
    }
}

// --- interface + class: the interface adds members to the class
//     TYPE without adding implementation -------------------------

export class Widget {
    render(): string {
        return "widget";
    }
}

export interface Widget {
    // declared here, assigned at runtime elsewhere (the mixin idiom)
    readonly cachedHeight: number;
}

// --- consumption, so the merges are load-bearing ---------------

export function useMerges(store: Store): string {
    const one = store.read("a");
    const two = store.read("a", "fallback");
    store.write("b", "c");

    createId.reset();
    const id = createId(createId.counter);

    const validator = new Validation.LengthValidator(2);
    const colour = Colour.parse("red") ?? Colour.Green;

    return [
        one ?? "",
        two,
        id,
        String(validator.check("abc")),
        colour,
        String(Album.maxTracks),
        Album.empty().title,
        track.title,
        String(config.retries),
    ].join("|");
}
