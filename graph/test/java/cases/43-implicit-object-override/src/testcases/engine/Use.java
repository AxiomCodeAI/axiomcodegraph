package testcases.engine;

public class Use {
  /** the receiver is only known as QuietAppendable: the client override beneath it, plus Object's own as the boundary */
  static String render(QuietAppendable accum) { return accum.toString(); }
  /** an arity-one Object member with one client override */
  static boolean same(QuietAppendable a, Object b) { return a.equals(b); }
  /** no client override anywhere: the boundary alone */
  static int hash(QuietAppendable a) { return a.hashCode(); }
  /** the receiver's exact type is known: its own toString, known_edge */
  static String exact() { return new StringBuilderAppendable().toString(); }
  public static void main(String[] args) {
    render(new StringBuilderAppendable()); same(new NullAppendable(), null); hash(new NullAppendable()); exact();
  }
}
