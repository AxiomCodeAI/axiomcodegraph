package testcases.engine;

/**
 * Engine test — INTERFACE DEPENDENCY INJECTION + VIRTUAL DISPATCH.
 *
 * A field/param is declared as an INTERFACE, but the real object is a concrete
 * class that IMPLEMENTS the interface and OVERRIDES the method. When we see
 * `dep.run(x)` on the interface-typed field, does resolution link to:
 *   (a) Handler.handle          — the interface's own (abstract) method, or
 *   (b) FastHandler.handle      — the concrete implementor's override?
 *
 * Static-type resolution gives (a). Linking to (b) needs reverse hierarchy
 * (implementors) + either CHA (all impls) or DI/data-flow (the injected impl).
 */

interface Handler {
    String handle(String input);          // abstract — the declared-type method
}

class FastHandler implements Handler {
    @Override
    public String handle(String input) {  // the OVERRIDE we'd want dispatch to reach
        return "fast:" + input;
    }
}

class SlowHandler implements Handler {
    @Override
    public String handle(String input) {  // a SECOND implementor (ambiguity for CHA)
        return "slow:" + input;
    }
}

public class InterfaceDI {

    // DI: field declared as the INTERFACE (not the concrete class)
    private final Handler handler;

    // constructor injection — the concrete type flows in here
    InterfaceDI(Handler handler) {
        this.handler = handler;
    }

    // invocation on the interface-typed field
    String process(String input) {
        return handler.handle(input);     // <-- interface-typed receiver call
    }

    // invocation on an interface-typed parameter
    String processWith(Handler h, String input) {
        return h.handle(input);           // <-- interface-typed param call
    }

    // the concrete binding is created here (what DI/data-flow would track)
    static InterfaceDI wire() {
        Handler impl = new FastHandler();     // concrete type assigned to interface var
        return new InterfaceDI(impl);         // flows into the field
    }
}
