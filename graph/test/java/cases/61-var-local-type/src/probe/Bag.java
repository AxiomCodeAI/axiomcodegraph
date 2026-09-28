package probe;

import java.util.Iterator;

/** A client generic that is iterable over its own type argument. */
public class Bag<T> implements Iterable<T> {
    @Override
    public Iterator<T> iterator() {
        return null;
    }
}
