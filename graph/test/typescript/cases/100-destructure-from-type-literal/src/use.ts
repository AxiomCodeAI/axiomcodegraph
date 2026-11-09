// A name destructured out of a value whose declared type is an object TYPE LITERAL
// (inline, or through an alias) takes that member's type, as `opts.port.execute()` does.
export interface Port { execute(x: number): number }
export interface Clock { now(): number }

export function inlineVar(opts: { port: Port; n: number }) {
    const { port } = opts;
    return port.execute(1);                 // -> Port.execute
}
export function memberAccess(opts: { port: Port }) {
    return opts.port.execute(2);            // -> Port.execute (already resolved: the reference)
}
type Opts = { port: Port; clock: Clock };
export function aliasParam({ port, clock }: Opts) {
    clock.now();                            // -> Clock.now
    return port.execute(3);                 // -> Port.execute
}
export function inlineParam({ port }: { port: Port }) {
    return port.execute(4);                 // -> Port.execute
}
export function aliasVar(o: Opts) {
    const { clock } = o;
    return clock.now();                     // -> Clock.now
}
export function nestedShape(opts: { deps: { port: Port } }) {
    const { deps } = opts;
    const { port } = deps;
    return port.execute(5);                 // -> Port.execute
}
export function shapeMethod(opts: { run(x: number): number }) {
    const { run } = opts;
    return run(6);                          // -> the type literal's run
}

// controls: no declared type, and a name the shape does not have
export function untyped(opts: any) {
    const { port } = opts;
    return port.execute(7);                 // stays unresolved
}
export function absent(opts: { clock: Clock }) {
    const { port } = opts as { clock: Clock; port?: never };
    return port;                            // no call
}
export function otherShape(opts: { port: { execute(x: number): number } }) {
    const { port } = opts;
    return port.execute(8);                 // -> its own literal's execute, NOT Port.execute
}
