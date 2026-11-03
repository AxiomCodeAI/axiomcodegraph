// A parameter destructured where its type comes from the context, not an annotation.
export interface Utils {
    send(url: string): number;
    sleep(ms: number): void;
}
export interface Ctx {
    url: string;
    utils: Utils;
}

// typed by the const's function-type annotation: `utils.send` is Utils.send
export const viaConst: (ctx: Ctx) => number = ({ url, utils }) => {
    return utils.send(url);
};

// the same arrow with a plain parameter (already resolved; must not change)
export const plainConst: (ctx: Ctx) => number = (ctx) => {
    return ctx.utils.send(ctx.url);
};

// an annotated pattern (already resolved; must not change)
export function annotated({ url, utils }: Ctx): number {
    return utils.send(url);
}

// control: a destructured parameter with no type anywhere stays unresolved
export const untyped = ({ url, utils }: any) => {
    return utils.send(url);
};

// control: a local object of another type with a member of the same name
export interface Other { send(url: string): string }
export const otherConst: (o: { utils: Other; url: string }) => string = ({ url, utils }) => {
    return utils.send(url);
};

// written in a slot of a nested literal whose type comes from the call's parameter
type Slots = { start?: (ctx: Ctx) => number };
export function define(seed: { name: string } & { lifecycle?: Slots }) { return seed; }
export const op = define({
    name: "op",
    lifecycle: {
        start: ({ url, utils }) => utils.send(url),
    },
});
export const op2 = define({
    name: "op2",
    lifecycle: {
        start: (ctx) => ctx.utils.send(ctx.url),
    },
});
