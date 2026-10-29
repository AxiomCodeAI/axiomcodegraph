// A member chain through nested inline object types. Each level reads a shape-typed
// property off a shape, and the chain stopped after the first.
class Logger { write(msg: string): void {} }
interface Order {
  meta: { audit: { log: Logger; nested: { deep: { log: Logger } } } };
}
function record(o: Order): void {
  o.meta.audit.log.write("a");
  o.meta.audit.nested.deep.log.write("b");
}
// controls: one level of literal, and a named type at every level
interface Flat { meta: { log: Logger } }
interface Named { meta: Meta }
interface Meta { log: Logger }
function flat(f: Flat): void { f.meta.log.write("c"); }
function named(n: Named): void { n.meta.log.write("d"); }
export { record, flat, named };
