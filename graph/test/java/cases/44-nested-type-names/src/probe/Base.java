package probe;

/** A member type inherited by an implementor: inside Sub, the bare name Kind is Base.Kind. */
public interface Base {
    enum Kind {
        A, B;
        String key() { return name(); }
    }

    void use(Kind k);
}
