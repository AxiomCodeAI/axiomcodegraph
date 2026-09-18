'use strict';
class Base {
  clone() { return new this.constructor(); }
  make() { return new this.constructor(); }
  run() { return 'base'; }
  static build() { return new this(); }
}
class Sub extends Base { run() { return 'sub'; } }
class Other extends Base { run() { return 'other'; } }
function main() {
  const s = new Sub();
  s.clone().run();
  Sub.build().run();
  new Base().make().run();
}
main();
