package java.lang;

/** Staged, so a call ON a String is answerable — which is what makes the case below about the
 *  RECEIVER's missing type rather than about the callee's. */
public class String {
    public String toString() { return this; }
    public int length() { return 0; }
}
