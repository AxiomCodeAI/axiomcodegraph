package pkg;

import java.util.function.IntSupplier;
import org.junit.jupiter.api.Test;

class HelperTest {
    // a helper: it runs when a test calls it, not before every test of the class
    static Price one() { return Price.parse("1"); }

    // a helper no test calls
    static void unused() { Unrelated.pong(); }

    @Test
    void usesHelper() { one(); }

    @Test
    void other() { Unrelated.ping(); }

    @Test
    void viaLambda() {
        IntSupplier s = () -> Unrelated.lazy();
        s.getAsInt();
    }

    @Test
    void viaAnonymous() {
        Runnable r = new Runnable() {
            public void run() { Unrelated.later(); }
        };
        r.run();
    }
}
