// A chain whose hops are four different relations. A chain that prints them all the same is
// visibly wrong: a construction, a constructor chaining to another constructor, a method
// reference handed over rather than called, and an ordinary invocation.
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

class Store {
    private final List<String> rows = new ArrayList<>();
    private final String name;

    Store() {
        this("main");
    }

    Store(String name) {
        this.name = name;
    }

    void put(String row) {
        rows.add(row);
    }
}

class Service {
    private final Store store = new Store();

    void add(String row) {
        store.put(row);
    }

    Consumer<String> adder() {
        return this::add;
    }
}

public class Pipeline {
    public static void main(String[] args) {
        Service svc = new Service();
        svc.add("a");
        svc.adder().accept("b");
    }
}
