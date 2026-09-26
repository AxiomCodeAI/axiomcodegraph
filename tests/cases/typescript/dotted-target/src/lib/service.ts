import { Circle, Square, Shape } from './model';
export function total(shapes: Shape[]): number {
  let sum = 0;
  for (const s of shapes) sum += s.area();
  return sum;
}
export function main(): void {
  console.log(total([new Circle(1), new Square(2)]));
}
