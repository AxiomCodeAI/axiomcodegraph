package probe;

// a subtype: a listener for OrderPlaced receives it, a listener for this type does not receive a plain OrderPlaced
public class ExpressOrderPlaced extends OrderPlaced {
    public ExpressOrderPlaced(String id) { super(id); }
}
