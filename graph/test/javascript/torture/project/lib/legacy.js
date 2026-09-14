'use strict';
// ── pre-ES6 classes: constructor functions, prototype members, util.inherits, Object.create, mixins ──
const util = require('util');
const EventEmitter = require('events');
function Animal(name) { this.name = name; }
Animal.prototype.speak = function () { return this.sound() + ' from ' + this.name; };
Animal.prototype.sound = function () { return '...'; };
Animal.make = function (name) { return new Animal(name); };
function Dog(name) { Animal.call(this, name); }
util.inherits(Dog, Animal);
Dog.prototype.sound = function () { return 'woof'; };
function Cat(name) { Animal.call(this, name); }
Cat.prototype = Object.create(Animal.prototype);
Cat.prototype.constructor = Cat;
Cat.prototype.sound = function () { return 'meow'; };
const Loud = {
  shout() { return this.speak().toUpperCase(); },
};
Object.assign(Dog.prototype, Loud);
function Kennel() { EventEmitter.call(this); this.dogs = []; }
util.inherits(Kennel, EventEmitter);
Kennel.prototype.add = function (dog) { this.dogs.push(dog); this.emit('added', dog); return this; };
Kennel.prototype.roll = function () { return this.dogs.map(function (d) { return d.speak(); }); };
module.exports = { Animal, Dog, Cat, Kennel };
