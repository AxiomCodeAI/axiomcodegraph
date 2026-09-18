package dep;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;

/**
 * Stands in for a dependency that DECLARES members by annotation rather than writing
 * them out. `getName`, `setName`, `getSize`, `isArchived`, `builder` and the `log` field
 * are members of the compiled artefact and of every caller's source; they are not in
 * this file.
 */
@Slf4j
@Builder
public class Catalog {
    @Getter @Setter private String name;
    @Getter private int size;
    @Getter private boolean archived;

    /** CONTROL: written out by hand, so it is in the IR. This one resolves today. */
    public String describe() {
        return name + ":" + size;
    }

    /**
     * CONTROL for shadowing: the field is annotated AND the accessor is written out.
     * One method exists and it is this one. A caller must reach the source declaration,
     * never a generated twin of it.
     */
    @Getter private String label;

    public String getLabel() {
        return label == null ? "" : label;
    }
}
