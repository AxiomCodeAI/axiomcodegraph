package torture;

// f05 — ANNOTATIONS (the "decorator" question in Java). An annotation never appears in an invoke
// instruction, so bytecode ground truth cannot see it at all: what it decides is which method is an
// ENTRY POINT, which bean satisfies which injection point, and which key binds where. Those land in
// the config relations, not in call-chain-edges, and this family exists to pin them.

import java.lang.annotation.ElementType;
import java.lang.annotation.Repeatable;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

public class F05Annotations {

    @Retention(RetentionPolicy.RUNTIME) @Target(ElementType.TYPE)
    @interface Component { String value() default ""; }

    @Retention(RetentionPolicy.RUNTIME) @Target({ElementType.FIELD, ElementType.CONSTRUCTOR})
    @interface Inject { }

    @Retention(RetentionPolicy.RUNTIME) @Target(ElementType.FIELD)
    @interface Qualifier { String value(); }

    @Retention(RetentionPolicy.RUNTIME) @Target(ElementType.METHOD)
    @interface Handles { String topic(); }

    @Retention(RetentionPolicy.RUNTIME) @Target(ElementType.METHOD)
    @Repeatable(Schedules.class) @interface Schedule { String cron(); }
    @Retention(RetentionPolicy.RUNTIME) @Target(ElementType.METHOD)
    @interface Schedules { Schedule[] value(); }

    // META-ANNOTATION: an annotation annotated with another one. A rule that reads only the
    // directly-written annotation cannot see that Service IS a Component.
    @Retention(RetentionPolicy.RUNTIME) @Target(ElementType.TYPE)
    @Component @interface Service { }

    interface Store { String read(String k); }

    @Component("primaryStore")
    static class PrimaryStore implements Store { public String read(String k) { return k; } }

    @Component
    static class BackupStore implements Store { public String read(String k) { return "b" + k; } }

    @Service                                   // via the meta-annotation, not written directly
    static class Reader {
        @Inject @Qualifier("primaryStore") Store store;

        // ANNOTATION-DRIVEN ENTRY POINT: nothing in the program calls this; the framework does.
        @Handles(topic = "orders")
        void onOrders(String payload) { store.read(payload); }

        @Schedule(cron = "0 * * * *")
        @Schedule(cron = "30 * * * *")         // repeatable: two annotations, one method
        void sweep() { store.read("sweep"); }

        // a plain method, called from the program, as the control
        String direct() { return store.read("x"); }
    }

    // an annotation ARGUMENT that names a class — a reference the graph should carry
    @Retention(RetentionPolicy.RUNTIME) @Target(ElementType.TYPE)
    @interface Uses { Class<?> value(); }

    @Uses(PrimaryStore.class)
    static class Client {
        String go(Reader r) { return r.direct(); }
    }
}
