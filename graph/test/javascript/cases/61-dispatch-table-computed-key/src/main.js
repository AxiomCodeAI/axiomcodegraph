// A DISPATCH TABLE read with a computed key, and the three ways the read is written.
// The engine cannot know which property a key computed at run time selects, and that
// is not the bug. The bug the case pins is what happens when such a read is MERGED
// with a default: the unreadable side used to contribute nothing, so the default
// became the expression's only value and the call was reported at known_edge (#931).

function fromA(a, b) { return a; }
function fromB(a, b) { return b; }
function deep(a, b) { return [a, b]; }
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const table = { url: fromA, method: fromA, data: fromB };

// THE CONSTRUCT, form 1: defaulted with `||`.
function viaOr(prop, a, b) {
  const chosen = table[prop] || deep;
  return chosen(a, b);
}

// THE CONSTRUCT, form 2: defaulted with a conditional. Same shape, different syntax.
function viaTernary(prop, a, b) {
  const chosen = has(table, prop) ? table[prop] : deep;
  return chosen(a, b);
}

// THE CONSTRUCT, form 3: no default at all, and the read is called directly. Nothing
// merges here, so the site was already honest; it is listed to show the widened value
// set reaches the call rather than only the variable.
function viaDirect(prop, a, b) {
  return table[prop](a, b);
}

// CONTROL 1: the key is WRITTEN AS A LITERAL, so the exact property is known and the
// widening must not touch it. This is the site that proves the rule is targeted: if it
// gains fromB or deep, precision was traded for the constructs above.
function viaLiteralKey(a, b) {
  const chosen = table['url'] || deep;
  return chosen(a, b);
}

// CONTROL 2: a dotted read of the same table, which was never a computed access.
function viaDottedKey(a, b) {
  const chosen = table.data || deep;
  return chosen(a, b);
}

// CONTROL 3: the default alone, with no table read beside it. The single known target
// is correct here and must stay a known_edge.
function viaDefaultOnly(a, b) {
  const chosen = deep;
  return chosen(a, b);
}

// CONTROL 4: an ARRAY read with a computed index. An array is not an object literal
// with named properties and the rule excludes it by kind, so this must not widen.
const steps = [fromA, fromB];
function viaArrayIndex(i, a, b) {
  const chosen = steps[i] || deep;
  return chosen(a, b);
}

const key = process.argv[2];
viaOr(key, 1, 2);
viaTernary(key, 1, 2);
viaDirect(key, 1, 2);
viaLiteralKey(1, 2);
viaDottedKey(1, 2);
viaDefaultOnly(1, 2);
viaArrayIndex(Number(key), 1, 2);
