package probe;

public class Walk {
    boolean viaZeroArg(Item item) {
        return item.name().equals("1");          // String.equals: a library boundary, never Item.equals
    }
    boolean viaOneArg(Item item) {
        return item.name("x").equals(item);      // Item.equals
    }
    boolean viaSelf(Item item) {
        return item.self().equals(item);         // Item.equals (control: no overload)
    }
}
