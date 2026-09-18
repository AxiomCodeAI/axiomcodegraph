package dep;

import lombok.Getter;
import lombok.Setter;

/**
 * A library whose lombok.config sets an accessors prefix. The processor strips `m`
 * from a field name before building the accessor, so `mDepth` declares `getDepth()`
 * and NOT `getMDepth()`.
 */
public class Point {
    /** SUBJECT: prefixed, so the accessors drop the `m`. */
    @Getter @Setter private Double mDepth;

    /**
     * CONTROL, and the one a naive prefix strip gets wrong: the field is named `mode`.
     * The character after the prefix is lowercase, so the processor does NOT strip it
     * and the accessor is `getMode()`.
     */
    @Getter private String mode;

    /** CONTROL: no prefix to strip at all. */
    @Getter private int size;
}
