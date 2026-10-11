package probe;

import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

/** #1406: fluent = true names the accessors after the field, and implies chain. */
@Getter
@Setter
@Accessors(fluent = true)
public class Node {
    private String label;
    private Node next;
    /** A field-level @Accessors overrides the type's: this one is not fluent. */
    @Accessors(fluent = false)
    private int weight;

    public void visit() {
    }
}
