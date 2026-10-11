package probe;

import lombok.AllArgsConstructor;

/** #1407: staticName declares a static factory with the constructor's arity. */
@AllArgsConstructor(staticName = "of")
public class Point {
    private int x;
    private int y;

    public int sum() {
        return x + y;
    }
}
