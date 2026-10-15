package pkg;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

public class Arr extends Elem implements Iterable<Elem> {
    private final List<Elem> items = new ArrayList<>();

    @Override
    public Elem copy() { return new Arr(); }

    @Override
    public Iterator<Elem> iterator() { return items.iterator(); }
}
