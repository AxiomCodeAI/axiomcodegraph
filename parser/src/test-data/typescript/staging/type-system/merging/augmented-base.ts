// fixture: type-system/merging/augmented-base
// nature: runtime-bearing
//
// The module being augmented from elsewhere. Nothing here refers to the
// augmentation: the extra members arrive from another file entirely, which is
// what makes module augmentation impossible to see from this file alone.

export interface Request {
    readonly url: string;
    readonly headers: ReadonlyMap<string, string>;
}

export interface Session {
    readonly id: string;
}

export class Application {
    private readonly middleware: Array<(request: Request) => void> = [];

    use(handler: (request: Request) => void): this {
        this.middleware.push(handler);
        return this;
    }

    handle(request: Request): number {
        for (const handler of this.middleware) {
            handler(request);
        }
        return this.middleware.length;
    }
}

export const VERSION = "1.0.0";
