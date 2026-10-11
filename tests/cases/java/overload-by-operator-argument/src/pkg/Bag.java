package pkg;

import java.util.ArrayList;
import java.util.List;

public class Bag {
    private final List<Node> nodes = new ArrayList<>();

    public Bag(int capacity) { }

    public Bag(Node... nodes) { }

    public void drop(int index) { nodes.remove(index); }

    public void drop(String name) { }

    public void flag(boolean on) { }

    public void flag(Node node) { }
}
