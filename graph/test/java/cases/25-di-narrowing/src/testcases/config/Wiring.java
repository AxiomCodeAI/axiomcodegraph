package testcases.config;

/**
 * Engine test — DI NARROWING. The one place config makes the call graph SMALLER.
 *
 * Case 09 pins the status quo: an interface-typed receiver fans to EVERY implementor
 * (multi_inferred), because static types alone cannot say which one was injected.
 * A container can say. This case pins exactly when we are allowed to use that, and —
 * just as importantly — when we are NOT.
 *
 *   (A) store.read    ONE bean implements Store   -> narrowed to DbStore#read
 *   (B) codec.encode  TWO beans implement Codec   -> must STAY multi_inferred
 *   (C) picked.encode TWO beans, but @Qualifier names one -> narrowed to JsonCodec
 *   (D) Service2      constructor injection into a FINAL field -> narrowed
 *
 * (B) is the soundness guard: if narrowing (B) ever starts working, the rule is
 * guessing, and the golden must fail.
 */

// ── minimal stand-ins for the framework annotations, so the case compiles with
// javac and the bytecode oracle still applies. Matching is on the SIMPLE name, so
// these behave exactly like org.springframework's.
@interface Service { String value() default ""; }
@interface Autowired { }
@interface Qualifier { String value(); }

interface Store { String read(String k); }

@Service
class DbStore implements Store {
    public String read(String k) { return "db:" + k; }
}

// A second implementor that is NOT a bean. The container would never inject it,
// so CHA's fan to it is not merely imprecise — it is wrong.
class InMemoryStore implements Store {
    public String read(String k) { return "mem:" + k; }
}

interface Codec { String encode(String s); }

@Service
class JsonCodec implements Codec {
    public String encode(String s) { return "j" + s; }
}

@Service
class XmlCodec implements Codec {
    public String encode(String s) { return "x" + s; }
}

@Service
class Service1 {
    @Autowired Store store;                             // (A) one candidate bean
    @Autowired Codec codec;                             // (B) two candidate beans
    @Autowired @Qualifier("jsonCodec") Codec picked;    // (C) two, narrowed by name

    String a(String k) { return store.read(k); }
    String b(String s) { return codec.encode(s); }
    String c(String s) { return picked.encode(s); }
}

@Service
class Service2 {
    // (D) constructor injection into a final field. `final` is what makes this
    // sound: the field cannot be reassigned, so the injected object is the only
    // value it can ever hold.
    private final Store store;

    Service2(Store store) { this.store = store; }

    String d(String k) { return store.read(k); }
}
