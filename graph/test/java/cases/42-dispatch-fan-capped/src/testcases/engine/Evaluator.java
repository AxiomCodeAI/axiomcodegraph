package testcases.engine;

/** A base whose fan (22 overrides) exceeds the default --dispatch-cap of 20. */
abstract class Evaluator {
  abstract boolean matches(String s);
  boolean any(String s) { return matches(s); }
}
class Ev1 extends Evaluator { boolean matches(String s) { return s.length() == 1; } }
class Ev2 extends Evaluator { boolean matches(String s) { return s.length() == 2; } }
class Ev3 extends Evaluator { boolean matches(String s) { return s.length() == 3; } }
class Ev4 extends Evaluator { boolean matches(String s) { return s.length() == 4; } }
class Ev5 extends Evaluator { boolean matches(String s) { return s.length() == 5; } }
class Ev6 extends Evaluator { boolean matches(String s) { return s.length() == 6; } }
class Ev7 extends Evaluator { boolean matches(String s) { return s.length() == 7; } }
class Ev8 extends Evaluator { boolean matches(String s) { return s.length() == 8; } }
class Ev9 extends Evaluator { boolean matches(String s) { return s.length() == 9; } }
class Ev10 extends Evaluator { boolean matches(String s) { return s.length() == 10; } }
class Ev11 extends Evaluator { boolean matches(String s) { return s.length() == 11; } }
class Ev12 extends Evaluator { boolean matches(String s) { return s.length() == 12; } }
class Ev13 extends Evaluator { boolean matches(String s) { return s.length() == 13; } }
class Ev14 extends Evaluator { boolean matches(String s) { return s.length() == 14; } }
class Ev15 extends Evaluator { boolean matches(String s) { return s.length() == 15; } }
class Ev16 extends Evaluator { boolean matches(String s) { return s.length() == 16; } }
class Ev17 extends Evaluator { boolean matches(String s) { return s.length() == 17; } }
class Ev18 extends Evaluator { boolean matches(String s) { return s.length() == 18; } }
class Ev19 extends Evaluator { boolean matches(String s) { return s.length() == 19; } }
class Ev20 extends Evaluator { boolean matches(String s) { return s.length() == 20; } }
class Ev21 extends Evaluator { boolean matches(String s) { return s.length() == 21; } }
class Ev22 extends Evaluator { boolean matches(String s) { return s.length() == 22; } }
