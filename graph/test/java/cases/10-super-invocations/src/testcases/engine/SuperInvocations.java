package testcases.engine;

import java.util.ArrayList;
import java.util.function.Supplier;

/**
 * Engine test — SUPER / THIS / INHERITED INVOCATIONS.
 *
 * Exercises the inheritance-driven call forms that need type_parent +
 * type_ancestor + ancestor-aware dispatch. Each call is tagged with a scenario
 * number and whether the target lives in a PARENT (in-file), an INTERFACE
 * default, or the JDK.
 *
 * Scenarios:
 *   1. super(args)          — constructor delegation to a parent constructor
 *   2. this(args)           — constructor delegation to a sibling constructor
 *   3. super.method()       — call the overridden parent method
 *   4. inherited method     — call a parent method by simple name (implicit this)
 *   5. Iface.super.default() — interface default method via super
 *   6. super::method        — super method reference
 *   7. JDK super            — extend a JDK type, call super()/super.add()/inherited size()
 *   8. virtual dispatch     — this.overridden() resolves to the override, not parent
 */

/** Interface with a default method (scenario 5 target). */
interface Named {
    String name();
    default String label() {
        return "named:" + name();          // interface-internal call (implicit this)
    }
}

/** Parent class — target of super(...) and inherited/overridden calls. */
class Base {
    protected final String id;

    Base() {
        this("base-default");              // (2) this(...) delegation within Base
    }

    Base(String id) {                      // target of super(id)
        this.id = id;
    }

    String sound() {
        return "base-sound";
    }

    String describe() {
        return "Base:" + id;               // inherited-call target (scenario 4)
    }

    void init() {
        System.out.println("Base.init " + id);   // JDK call inside parent
    }
}

/** Main subclass: extends an in-file parent AND implements an interface. */
public class SuperInvocations extends Base implements Named {

    private final int level;

    // (1) super(String) — explicit args to the parent constructor
    public SuperInvocations(String id) {
        super(id);
        this.level = 0;
    }

    // (2) this(...) delegation — chains to the ctor above, which calls super(id)
    public SuperInvocations() {
        this("derived-default");
    }

    // (1) another super(...) call site
    public SuperInvocations(String id, int level) {
        super(id);
        this.level = level;
    }

    @Override
    public String name() {
        return id;                          // uses the inherited field `id`
    }

    // (3) super.method() + override of a parent method
    @Override
    String sound() {
        return super.sound() + "!override"; // super.sound() -> Base.sound()
    }

    // (4) inherited method call (describe/init defined only in Base) + (8) virtual dispatch
    String report() {
        String d = describe();              // (4) inherited, implicit this
        this.init();                        // (4) inherited via explicit this
        String s = sound();                 // (8) resolves to THIS class's override
        return d + "/" + s + "/lvl" + level;
    }

    // (5) Interface.super.default()
    String labelViaSuper() {
        return Named.super.label();         // interface default via super
    }

    // (6) super::method reference
    Supplier<String> soundRef() {
        return super::sound;                // bound to Base.sound()
    }

    // driver mixing forms
    public static void main(String[] args) {
        SuperInvocations a = new SuperInvocations();      // (2)->(1) ctor chain
        SuperInvocations b = new SuperInvocations("x", 3);// (1)
        System.out.println(a.report());                   // in-file call on new object
        System.out.println(b.labelViaSuper());            // (5)
        System.out.println(b.soundRef().get());           // (6) then functional call
        ListExt le = new ListExt();                       // (7) JDK-super subclass
        le.addTagged("hello");
    }
}

/** JDK super: extend java.util.ArrayList and call super()/super.add()/inherited size(). */
class ListExt extends ArrayList<String> {

    ListExt() {
        super();                            // (7) super() -> JDK ArrayList()
    }

    void addTagged(String s) {
        super.add("tag:" + s);             // (7) super.add() -> JDK ArrayList.add()
        int n = size();                     // (7) inherited JDK size(), implicit this
        super.add("count:" + n);
    }
}
