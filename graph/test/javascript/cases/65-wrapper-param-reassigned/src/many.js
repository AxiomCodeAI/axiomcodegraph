// Enough callers to put `swapped` over the parameter fan cap.
const { A, swapped } = require("./wrap");
const s01 = swapped(() => new A()); const s02 = swapped(() => new A()); const s03 = swapped(() => new A());
const s04 = swapped(() => new A()); const s05 = swapped(() => new A()); const s06 = swapped(() => new A());
const s07 = swapped(() => new A()); const s08 = swapped(() => new A()); const s09 = swapped(() => new A());
const s10 = swapped(() => new A()); const s11 = swapped(() => new A()); const s12 = swapped(() => new A());
const s13 = swapped(() => new A()); const s14 = swapped(() => new A()); const s15 = swapped(() => new A());
const s16 = swapped(() => new A()); const s17 = swapped(() => new A()); const s18 = swapped(() => new A());
const s19 = swapped(() => new A()); const s20 = swapped(() => new A()); const s21 = swapped(() => new A());
function capped() {
  s21().replacedOnly();
  s21().aOnly();
}
module.exports = { capped, all: [s01, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20] };
