'use strict';
const __axiom = require("../__axiom_runtime.js"); const __p = __axiom.enter("lib/legacy.js:1:1");
// ── pre-ES6 classes: constructor functions, prototype members, util.inherits, Object.create, mixins ──
const util = require('util');
const EventEmitter = require('events');
function Animal(name) {
    return __axiom.run("lib/legacy.js:5:1", () => {
        this.name = name;
    });
}
Animal.prototype.speak = function () {
    return __axiom.run("lib/legacy.js:6:26", () => {
        return this.sound() + ' from ' + this.name;
    });
};
Animal.prototype.sound = function () {
    return __axiom.run("lib/legacy.js:7:26", () => {
        return '...';
    });
};
Animal.make = function (name) {
    return __axiom.run("lib/legacy.js:8:15", () => {
        return new Animal(name);
    });
};
function Dog(name) {
    return __axiom.run("lib/legacy.js:9:1", () => {
        Animal.call(this, name);
    });
}
util.inherits(Dog, Animal);
Dog.prototype.sound = function () {
    return __axiom.run("lib/legacy.js:11:23", () => {
        return 'woof';
    });
};
function Cat(name) {
    return __axiom.run("lib/legacy.js:12:1", () => {
        Animal.call(this, name);
    });
}
Cat.prototype = Object.create(Animal.prototype);
Cat.prototype.constructor = Cat;
Cat.prototype.sound = function () {
    return __axiom.run("lib/legacy.js:15:23", () => {
        return 'meow';
    });
};
const Loud = {
    shout() {
        return __axiom.run("lib/legacy.js:17:3", () => {
            return this.speak().toUpperCase();
        });
    },
};
Object.assign(Dog.prototype, Loud);
function Kennel() {
    return __axiom.run("lib/legacy.js:20:1", () => {
        EventEmitter.call(this);
        this.dogs = [];
    });
}
util.inherits(Kennel, EventEmitter);
Kennel.prototype.add = function (dog) {
    return __axiom.run("lib/legacy.js:22:24", () => {
        this.dogs.push(dog);
        this.emit('added', dog);
        return this;
    });
};
Kennel.prototype.roll = function () {
    return __axiom.run("lib/legacy.js:23:25", () => {
        return this.dogs.map(function (d) {
            return __axiom.run("lib/legacy.js:23:60", () => {
                return d.speak();
            });
        });
    });
};
module.exports = { Animal, Dog, Cat, Kennel };

__axiom.exit(__p);
