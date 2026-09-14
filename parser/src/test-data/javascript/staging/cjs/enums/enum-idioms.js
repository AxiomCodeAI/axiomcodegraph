// fixture: cjs/enums/enum-idioms.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// NO ANALOGUE. JavaScript has no `enum` — not as a keyword, not as a reserved
// declaration form, not at all. ts_enum_member has no js_* counterpart and the
// schema says so explicitly. Java's enum constructors, per-constant fields,
// per-constant class bodies and `implements` on an enum have no port either.
//
// What real JavaScript does INSTEAD is what this file covers, because a fixture
// that invented an enum would be testing a construct the language does not have.
// Four idioms appear in practice, and none of them is a declaration form — each
// is an object or a set of constants, so a parser must NOT mint a type for them.
// That is the property worth pinning: these are VALUES.
//
// Grounded in the platform's `errno` tables and `http.STATUS_CODES` object, a charting library's
// frozen constant maps, and the Symbol-based sentinels in View's source.

'use strict';

// --- idiom 1: a frozen object literal ------------------------------------------
//
// The commonest form. Object.freeze is the only enforcement, it is shallow, and
// it happens at runtime.

const Color = Object.freeze({
  RED: 'red',
  GREEN: 'green',
  BLUE: 'blue'
});

// Numeric values, and a computed one — the JavaScript equivalent of a
// constant-expression enum member.
const Level = Object.freeze({
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  MAX: 40 + 10
});

// Bit flags, which are what an enum is usually being used for.
const Permission = Object.freeze({
  NONE: 0,
  READ: 1 << 0,
  WRITE: 1 << 1,
  EXECUTE: 1 << 2,
  ALL: (1 << 0) | (1 << 1) | (1 << 2)
});

// NOT frozen. Same shape, mutable, and nothing in the syntax distinguishes the
// two — which is why treating "an object of constants" as an enum declaration
// is a guess.
const Mutable = { A: 1, B: 2 };
Mutable.C = 3;

// --- idiom 2: Symbol constants ---------------------------------------------------
//
// Unique by construction, so two enums cannot collide and a value cannot be
// forged from a string. The description is not the identity.

const Direction = Object.freeze({
  UP: Symbol('UP'),
  DOWN: Symbol('DOWN')
});

// Symbol.for uses a global registry, so these ARE forgeable and equal across
// realms — the opposite property, same syntax.
const Shared = Object.freeze({
  PING: Symbol.for('app.ping')
});

// --- idiom 3: the reverse map -----------------------------------------------------
//
// TypeScript's numeric enums generate this. Written by hand it is two entries
// per member, built by a loop, so the member names are not literals in the
// source at all.

const Status = {};
[['OK', 200], ['NOT_FOUND', 404], ['ERROR', 500]].forEach(([name, code]) => {
  Status[name] = code;
  Status[code] = name;
});
Object.freeze(Status);

// --- idiom 4: a class of static constants -------------------------------------------
//
// The only idiom that produces a real js_type. Its members are static fields,
// and the instances are created by the class itself — which is the closest
// JavaScript gets to a Java enum with a constructor and per-constant state.

class Suit {
  constructor(name, symbol) {
    this.name = name;
    this.symbol = symbol;
    Object.freeze(this);
  }
  toString() { return this.symbol; }
  isRed() { return this === Suit.HEARTS || this === Suit.DIAMONDS; }
  static values() { return [Suit.HEARTS, Suit.DIAMONDS, Suit.CLUBS, Suit.SPADES]; }
  static valueOf(name) { return Suit.values().find((s) => s.name === name); }
}
Suit.HEARTS = new Suit('HEARTS', '♥');
Suit.DIAMONDS = new Suit('DIAMONDS', '♦');
Suit.CLUBS = new Suit('CLUBS', '♣');
Suit.SPADES = new Suit('SPADES', '♠');
Object.freeze(Suit);

// --- consumption ---------------------------------------------------------------------
//
// The switch over a "enum" — a switch over string values, with no exhaustiveness
// check of any kind, which is the concrete cost of not having the construct.

function describe(color) {
  switch (color) {
    case Color.RED: return 'warm';
    case Color.GREEN: return 'cool';
    case Color.BLUE: return 'cold';
    default: return 'unknown';       // reachable, unlike a TypeScript never-check
  }
}

function hasPermission(mask, permission) {
  return (mask & permission) === permission;
}

const allColors = Object.values(Color);
const colorNames = Object.keys(Color);
const isColor = (v) => allColors.includes(v);
const reverse = Status[404];

module.exports = {
  Color, Level, Permission, Mutable, Direction, Shared, Status, Suit,
  describe, hasPermission, allColors, colorNames, isColor, reverse
};
