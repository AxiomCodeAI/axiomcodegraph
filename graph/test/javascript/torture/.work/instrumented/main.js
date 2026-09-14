'use strict';
const __axiom = require("./__axiom_runtime.js"); const __p = __axiom.enter("main.js:1:1");
const { Shape, Circle, Square, Tagged } = require('./lib/shapes');
const legacy = require('./lib/legacy');
const F = require('./lib/functional');
const { Bus, onStart, onTick, onAny, hookA, hookB, handlerX } = require('./lib/bus');
const asyncy = require('./lib/asyncy');
const reg = require('./lib/registry');
const makePlugin = require('./plugins');
function classes() {
    return __axiom.run("main.js:10:1", () => {
        const c = new Circle(2);
        c.describe();
        c.area();
        c.label;
        c.label = 'x';
        const s = Shape.create('base');
        s.describe();
        const sq = Square.create('sq');
        sq.describe();
        const t = new Tagged('t');
        t.reveal();
        t.describe();
        [c, sq].sort(Shape.compare).map((x) => {
            return __axiom.run("main.js:16:35", () => {
                return x.area();
            });
        });
        c.clone().describe();
        c.subscribe((v) => {
            return __axiom.run("main.js:18:15", () => {
                return F.inc(v);
            });
        }).subscribe(F.twice).notify(3);
        c.onChange(4);
        return c;
    });
}
function legacies() {
    return __axiom.run("main.js:22:1", () => {
        const d = new legacy.Dog('rex');
        d.speak();
        d.shout();
        const cat = new legacy.Cat('tom');
        cat.speak();
        legacy.Animal.make('generic').speak();
        const k = new legacy.Kennel();
        k.on('added', function onAdded(dog) {
            return __axiom.run("main.js:27:17", () => {
                return dog.sound();
            });
        });
        k.add(d).add(cat);
        k.roll();
        return k;
    });
}
function functional() {
    return __axiom.run("main.js:31:1", () => {
        F.incTwice(1);
        F.addOne(2);
        F.fact(4);
        F.fib(5);
        F.counter.bump();
        F.counter.reset();
        F.withDefault();
        F.withDefault(() => {
            return __axiom.run("main.js:34:34", () => {
                return 5;
            });
        }, { mapper: F.inc, tag: true });
        F.variadic(F.inc, F.twice, (x) => {
            return __axiom.run("main.js:35:30", () => {
                return F.add(x, 1);
            });
        });
        F.applyAll([F.inc, F.twice], 1);
        F.slowSquare(3);
        F.slowSquare(3);
        const bound = F.add.bind(null, 10);
        bound(1);
        F.add.call(null, 1, 2);
        F.add.apply(null, [1, 2]);
    });
}
function events() {
    return __axiom.run("main.js:41:1", () => {
        const b = new Bus();
        b.on('start', onStart).once('tick', onTick).on(process.env.NOPE || 'dyn', onAny);
        b.start();
        b.fire('dyn');
        b.hook(hookA).hook(hookB).runHooks('v');
        b.register('x', handlerX);
        b.dispatch('x', 1);
        return b;
    });
}
async function asyncs() {
    return __axiom.run("main.js:49:1", async () => {
        await asyncy.pipeline(1);
        asyncy.later(F.inc);
        asyncy.withCallback(1, (err, v) => {
            return __axiom.run("main.js:52:26", () => {
                return F.twice(v);
            });
        });
        await asyncy.withCallbackP(2);
    });
}
function dynamics() {
    return __axiom.run("main.js:55:1", () => {
        reg.byName('update', 1);
        reg.byBracket(2);
        reg.viaProxy(3);
        reg.viaReflect(4);
        reg.viaArguments(5, 6);
        reg.tagged(7);
    });
}
function modules() {
    return __axiom.run("main.js:58:1", () => {
        const p = makePlugin('p');
        p.run();
        makePlugin.shapes.Circle.create('z');
        makePlugin.functional.twice(2);
        makePlugin.late();
        if (typeof makePlugin.orphan === 'function')
            throw new Error('orphan must not be exported');
    });
}
async function main() {
    return __axiom.run("main.js:61:1", async () => {
        classes();
        legacies();
        functional();
        events();
        await asyncs();
        dynamics();
        modules();
        (function iife() {
            return __axiom.run("main.js:63:4", () => {
                F.inc(9);
            });
        })();
        (() => {
            return __axiom.run("main.js:64:4", () => {
                return F.twice(9);
            });
        })();
    });
}
main();

__axiom.exit(__p);
