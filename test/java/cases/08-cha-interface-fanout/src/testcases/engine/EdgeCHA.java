package testcases.engine;

/**
 * Edge cases — CHA / override stressors for virtual_override + method_override.
 *   #3 anonymous class implementing an interface (synthetic name / ANONYMOUS placement)
 *   #4 abstract CLASS dispatch (method_override clause 1: ABSTRACT_METHOD, not INTERFACE_TYPE)
 *   #6 bridge method from a generic override (synthetic set(Object) beside set(String))
 */
public class EdgeCHA {

    // #4 abstract class (NOT interface) — exercises method_override clause 1
    abstract static class Codec {
        abstract String encode(String s);              // ABSTRACT_METHOD base
        String twice(String s) { return encode(s) + encode(s); }   // calls the abstract
    }
    static class UpperCodec extends Codec {
        @Override String encode(String s) { return s.toUpperCase(); }   // concrete override
    }

    // #3 anonymous class implementing an interface — is its override a CHA target?
    interface Sink { void accept(String s); }
    static class NamedSink implements Sink {           // named impl (control)
        @Override public void accept(String s) { System.out.println(s); }
    }
    Sink anon = new Sink() {                           // anonymous impl (the test)
        @Override public void accept(String s) { System.out.println("anon:" + s); }
    };

    // #6 bridge method: a generic override erases to set(Object) + emits synthetic bridge
    static class Box<T> {
        T val;
        void set(T t) { this.val = t; }                // erased signature set(Object)
        T get() { return val; }
    }
    static class SBox extends Box<String> {
        @Override void set(String s) { this.val = s; } // + synthetic bridge set(Object)
    }

    void driver(Sink s, Codec c) {
        s.accept("x");          // interface receiver -> CHA should reach {NamedSink, anon}
        c.encode("y");          // abstract-class receiver -> CHA -> UpperCodec.encode
        new UpperCodec().twice("z");
        new SBox().set("w");    // set(String) vs synthetic bridge set(Object) — same name+arity
    }
}
