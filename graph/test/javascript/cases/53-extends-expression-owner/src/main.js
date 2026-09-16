// An extends-clause expression belongs to the callable that lexically encloses
// the class, not to the module initializer (#730), so `class extends this` in a
// static factory gets its superclass.
export class Base {
  static tag() { return 'base-tag'; }
  greet() { return 'base-greet'; }
  static viaThis() { return class extends this {}; }
  static viaName() { return class extends Base {}; }
}
function mix(B) { return B; }
function viaLocalConst() {
  const Local = Base;
  return class extends Local {};
}
function viaParam(B) { return class extends mix(B) {}; }

export function main() {
  const FromThis = Base.viaThis(), FromName = Base.viaName();
  FromThis.tag();
  FromName.tag();
  new FromThis().greet();
  new FromName().greet();
  const FromConst = viaLocalConst();
  FromConst.tag();
  new FromConst().greet();
  const FromParam = viaParam(Base);
  FromParam.tag();
}
