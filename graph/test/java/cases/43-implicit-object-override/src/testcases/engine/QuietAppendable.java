package testcases.engine;

/** An abstract client base whose own hierarchy declares no toString: the one it inherits is Object's. */
abstract class QuietAppendable {
  abstract QuietAppendable append(String s);
}
final class StringBuilderAppendable extends QuietAppendable {
  QuietAppendable append(String s) { return this; }
  @Override public String toString() { return "sb"; }
  @Override public boolean equals(Object o) { return o == this; }
}
final class NullAppendable extends QuietAppendable {
  QuietAppendable append(String s) { return this; }
}
