'use strict';
const __axiom = require("../__axiom_runtime.js"); const __p = __axiom.enter("lib/shapes.js:1:1");
// ── classes: inheritance, super, statics, accessors, fields, this.constructor ──
class Shape {
    constructor(name) {
        return __axiom.run("lib/shapes.js:4:3", () => {
            this.name = name;
            this.listeners = [];
            this.onChange = (v) => {
                return __axiom.run("lib/shapes.js:4:78", () => {
                    return this.notify(v);
                });
            };
        });
    }
    area() {
        return __axiom.run("lib/shapes.js:5:3", () => {
            return 0;
        });
    }
    describe() {
        return __axiom.run("lib/shapes.js:6:3", () => {
            return this.name + ':' + this.area();
        });
    }
    static create(name) {
        return __axiom.run("lib/shapes.js:7:3", () => {
            return new this(name);
        });
    }
    static compare(a, b) {
        return __axiom.run("lib/shapes.js:8:3", () => {
            return a.area() - b.area();
        });
    }
    get label() {
        return __axiom.run("lib/shapes.js:9:3", () => {
            return this.describe();
        });
    }
    set label(v) {
        return __axiom.run("lib/shapes.js:10:3", () => {
            this.name = v;
        });
    }
    clone() {
        return __axiom.run("lib/shapes.js:11:3", () => {
            return new this.constructor(this.name);
        });
    }
    subscribe(fn) {
        return __axiom.run("lib/shapes.js:12:3", () => {
            this.listeners.push(fn);
            return this;
        });
    }
    notify(v) {
        return __axiom.run("lib/shapes.js:13:3", () => {
            this.listeners.forEach((l) => {
                return __axiom.run("lib/shapes.js:13:38", () => {
                    return l(v);
                });
            });
            return this;
        });
    }
}
class Circle extends Shape {
    constructor(r) {
        return __axiom.run("lib/shapes.js:16:3", () => {
            super('circle');
            this.r = r;
        });
    }
    area() {
        return __axiom.run("lib/shapes.js:17:3", () => {
            return 3 * this.r * this.r;
        });
    }
    describe() {
        return __axiom.run("lib/shapes.js:18:3", () => {
            return 'round ' + super.describe();
        });
    }
}
class Square extends Shape {
    area() {
        return __axiom.run("lib/shapes.js:21:3", () => {
            return 4;
        });
    }
}
class Tagged extends Square {
    #secret() {
        return __axiom.run("lib/shapes.js:24:3", () => {
            return 'hidden';
        });
    }
    reveal() {
        return __axiom.run("lib/shapes.js:25:3", () => {
            return this.#secret();
        });
    }
    static [Symbol.hasInstance](x) {
        return __axiom.run("lib/shapes.js:26:3", () => {
            return x instanceof Square;
        });
    }
}
module.exports = { Shape, Circle, Square, Tagged };

__axiom.exit(__p);
