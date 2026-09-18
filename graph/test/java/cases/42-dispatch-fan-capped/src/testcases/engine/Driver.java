package testcases.engine;

public class Driver {
  /** the receiver is only known as Evaluator: 22 overrides, refused by the cap, fan_capped */
  static boolean wide(Evaluator e, String s) { return e.matches(s); }
  /** the receiver's exact type is known: no fan at all, known_edge */
  static boolean exact(String s) { return new Ev3().matches(s); }
  /** three overrides, under the cap: multi_inferred */
  static int small(Small x) { return x.size(); }
  public static void main(String[] args) {
    wide(new Ev1(), "a"); exact("abc"); small(new SmallA());
  }
}
