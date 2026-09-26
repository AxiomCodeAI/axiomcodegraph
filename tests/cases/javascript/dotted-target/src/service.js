const { Circle, Square } = require('./model');
function total(shapes) {
  let sum = 0;
  for (const s of shapes) sum += s.area();
  return sum;
}
function main() {
  console.log(total([new Circle(1), new Square(2)]));
}
module.exports = { total, main };
