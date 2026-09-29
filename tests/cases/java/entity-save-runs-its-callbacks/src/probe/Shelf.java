package probe;

/** control: a project class with its own save(Item). Not a persistence store, so saving here runs no callback. */
public class Shelf {
    void save(Item item) { }
}
