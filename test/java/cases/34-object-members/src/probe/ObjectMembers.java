package probe;

// EVERY class inherits java.lang.Object, and no source file says so. A call to a member only
// Object declares therefore has to resolve through a supertype edge that no `extends` clause
// wrote — which is the whole content of this case.

public class ObjectMembers {

    static class Plain { }                               // no extends, no members of its own

    static class Declares {                              // declares its own toString/hashCode
        @Override public String toString() { return "d"; }
        @Override public int hashCode() { return 1; }
    }

    static class Overloads {                             // an OVERLOAD of an Object member, same arity
        public boolean equals(Plain p) { return true; }
    }

    // the member is only on Object, and the receiver is the implicit this
    String selfClass() { return getClass().getName(); }

    // the member is only on Object, and the receiver is a client type with no supertype
    String otherClass(Plain p) { return p.getClass().getSimpleName(); }
    int plainHash(Plain p) { return p.hashCode(); }
    boolean plainEquals(Plain p, java.lang.Object o) { return p.equals(o); }
    void plainNotify(Plain p) { p.notifyAll(); }

    // the type DECLARES the member: its own must win, and Object's must not appear beside it
    String declaredToString(Declares d) { return d.toString(); }
    int declaredHash(Declares d) { return d.hashCode(); }

    // an overload of the same name and arity suppresses the Object member, exactly as an
    // inherited method of the same name and arity is suppressed by DECLARED-WINS
    boolean overloaded(Overloads o, Plain p) { return o.equals(p); }

    // JLS 9.2: an interface implicitly declares the PUBLIC members of Object and only those.
    // clone() is protected, so it is NOT a member of Cloneable — and `super.clone()` below binds
    // through the supertypes of Sub, which include the interface. A rule that gives every type all
    // of Object's members answers this site with Base#clone() AND Object#clone(): a second, wrong
    // target on a site that has exactly one right one. The golden must show one.
    // Base's own `super.clone()` stays a DECLARED UNKNOWN in the golden: `super` binds through the
    // supertypes written down, and Base writes only `implements Cloneable`. Naming the implicit
    // Object superclass for `super` is a different rule from this one, and is not made here.
    static class Base implements Cloneable {
        @Override protected Base clone() throws CloneNotSupportedException { return (Base) super.clone(); }
    }
    static class Sub extends Base implements Cloneable {
        @Override protected Sub clone() throws CloneNotSupportedException { return (Sub) super.clone(); }
    }
}
