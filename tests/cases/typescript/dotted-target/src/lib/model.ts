import { square } from './util';
export interface Shape { area(): number; }
export class Circle implements Shape {
  constructor(private r: number) {}
  area(): number { return square(this.r) * Math.PI; }
}
export class Square implements Shape {
  constructor(private s: number) {}
  area(): number { return square(this.s); }
}
