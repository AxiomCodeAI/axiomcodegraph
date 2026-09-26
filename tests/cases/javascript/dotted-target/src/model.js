const { square } = require('./util');
class Circle {
  constructor(r) { this.r = r; }
  area() { return square(this.r) * Math.PI; }
}
class Square {
  constructor(s) { this.s = s; }
  area() { return square(this.s); }
}
module.exports = { Circle, Square };
