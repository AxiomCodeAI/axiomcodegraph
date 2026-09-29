package probe;

import lombok.Data;

/** #1404: a primitive boolean already named is + Uppercase keeps its name for the getter. */
@Data
public class Account {
    private boolean isLocked;
    /** CONTROL: the ordinary rule. */
    private boolean active;
    /** NEAR MISS: `is` followed by a lowercase letter is not the prefix; isIsland(). */
    private boolean island;
    /** NEAR MISS: a boxed Boolean named isX takes get, and keeps the whole name. */
    private Boolean isOpen;
}
