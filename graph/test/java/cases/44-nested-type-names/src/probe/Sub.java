package probe;

public class Sub implements Base {
    /** Kind is neither imported nor declared in this file; it is in scope through `implements Base`. */
    @Override public void use(Kind k) {
        k.key();
    }
}
