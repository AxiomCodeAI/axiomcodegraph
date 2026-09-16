export class Widget { go(): void { } }

const pattern = /Widget\/[a-z]+/g;

export function run(): Widget {
  const w = new Widget();
  w.go();
  return w;
}
