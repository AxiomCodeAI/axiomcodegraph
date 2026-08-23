// Pattern: ANONYMOUS CLASSES implementing a JDK interface / extending a JDK type.
// Like an interface implementation, but the type is declared and instantiated
// in one expression, overriding the JDK method inline.
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public class AnonymousClasses {

    public static void main(String[] args) {
        // Anonymous implementation of java.lang.Runnable, overriding run().
        Runnable task = new Runnable() {
            @Override
            public void run() {
                System.out.println("anonymous Runnable.run() executed");
            }
        };
        task.run();

        // Anonymous implementation of java.util.Comparator, overriding compare().
        List<String> items = new ArrayList<>(List.of("ccc", "a", "bb"));
        items.sort(new Comparator<String>() {
            @Override
            public int compare(String a, String b) {
                // Reverse-length order; calls back into JDK Integer.compare.
                return Integer.compare(b.length(), a.length());
            }
        });
        System.out.println("sorted by anonymous comparator = " + items);

        // Anonymous subclass of a JDK class (Thread), overriding run().
        Thread t = new Thread() {
            @Override
            public void run() {
                System.out.println("anonymous Thread subclass running on " + getName());
            }
        };
        t.run(); // run() directly (synchronous) so output is deterministic
    }
}
