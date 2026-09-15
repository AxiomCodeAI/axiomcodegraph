package testcases.engine;

/** A base with a fan of three, under the cap: the ordinary multi_inferred set. */
abstract class Small {
  abstract int size();
}
class SmallA extends Small { int size() { return 1; } }
class SmallB extends Small { int size() { return 2; } }
class SmallC extends Small { int size() { return 3; } }
