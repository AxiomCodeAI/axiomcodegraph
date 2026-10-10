package pkg;

import java.util.ArrayDeque;
import java.util.Deque;

public class Writer {
    private final Deque<Elem> stack = new ArrayDeque<>();

    // the deque is handed an Arr: it may call what Arr overrides from a library type, never copy()
    public void begin() {
        Arr array = new Arr();
        stack.push(array);
    }
}
