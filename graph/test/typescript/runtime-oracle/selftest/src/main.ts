// Every shape the rewrite has to survive. Printed output must be byte-identical
// before and after instrumentation; that is the semantic-preservation check.
const log: string[] = []
const say = (s: string) => log.push(s)

// 1. plain call, and a call nested in another call's arguments
function g(n: number) { say('g'); return n + 1 }
function f(n: number) { say('f'); return n * 2 }
say('r1=' + f(g(1)))

// 2. method call — `this` must survive the wrapper
class Counter {
  n = 0
  constructor(start: number) { this.n = start; say('ctor') }
  inc(by: number) { this.n += by; return this }
  get doubled() { say('getter'); return this.n * 2 }
}
const c = new Counter(5)
say('r2=' + c.inc(2).inc(3).n)
say('r3=' + c.doubled)

// 3. dynamic dispatch that is deterministic at run time
interface Shape { area(): number }
class Sq implements Shape { s: number; constructor(s: number) { this.s = s } area() { return this.s * this.s } }
class Ci implements Shape { r: number; constructor(r: number) { this.r = r } area() { return 3 * this.r * this.r } }
function totalArea(shapes: Shape[]) { return shapes.reduce((a, s) => a + s.area(), 0) }
say('r4=' + totalArea([new Sq(2), new Sq(3)]))

// 4. optional chain — the outer link only
const maybe: {b?: () => {c: () => string}} = {b: () => ({c: () => 'chain'})}
say('r5=' + maybe?.b?.().c())
const absent: {b?: () => {c: () => string}} = {}
say('r6=' + String(absent?.b?.().c()))

// 5. callback passed inline to a library function
say('r7=' + [1, 2, 3].map((x) => x * 10).join(','))

// 6. async and await inside an argument
async function slow(n: number) { return n + 100 }
async function runAsync() { say('r8=' + (await slow(await slow(1)))) }

// 7. generator — the body runs at .next(), not at the call
function* gen() { yield 1; yield 2 }
say('r9=' + [...gen()].join('+'))

// 8. a call that throws: the marker must not be inherited by the next call
function boom(): number { throw new Error('boom') }
function after() { say('after'); return 'ok' }
try { boom() } catch { say('caught') }
say('r10=' + after())

// 9. spread, tagged template, expression-bodied arrow, default parameter
const add = (a: number, b = g(0)) => a + b
function tag(strings: TemplateStringsArray, v: number) { return strings[0] + v }
say('r11=' + add(1, ...[2]))
say('r12=' + tag`v=${7}`)

// 10. recursion
function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2) }
say('r13=' + fib(6))

runAsync().then(() => {
  console.log(log.join('\n'))
})
