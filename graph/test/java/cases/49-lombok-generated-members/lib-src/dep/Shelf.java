package dep;

import lombok.Getter;

/**
 * A second hop. `getCatalog` is itself a generated accessor, so a call chained onto
 * its RESULT has to know what that result is. Until #885 the accessor resolved as a
 * callee and its return value had no type, which lost every second hop.
 */
public class Shelf {
    @Getter private Catalog catalog;

    /** CONTROL: hand-written, and returns the same type. */
    public Catalog current() {
        return catalog;
    }
}
