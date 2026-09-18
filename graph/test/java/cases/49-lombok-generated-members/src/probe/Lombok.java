package probe;

import dep.Catalog;
import lombok.Getter;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;

/**
 * GENERATED MEMBERS: an annotation processor on the compile path declares members that
 * the source file does not contain. Every call through one is a call to a method that
 * exists in the artefact and is absent from the IR, so the site is unresolved and
 * indistinguishable from a genuinely unknown receiver.
 *
 * The controls are the hand-written members beside them: `handWritten` on this class,
 * `describe` on the library type, and `getLabel`, which is BOTH annotated and written
 * out. All three resolve at origin/main, which is what makes the subjects' failure
 * specific to the generated members rather than to the receiver's type.
 */
@Slf4j
public class Lombok {

    @Getter @Setter private String label;
    @Getter private int count;
    @Getter private boolean ready;

    /** CONTROL: hand-written, same class. */
    public String handWritten() {
        return label;
    }

    /** SUBJECT A: the accessors the field annotations declare on this class. */
    public String ownAccessors() {
        setLabel("x");
        return getLabel() + getCount();
    }

    /** SUBJECT B: a primitive boolean takes `is`, not `get`. */
    public boolean ownBooleanAccessor() {
        return isReady();
    }

    /** SUBJECT C: the field the class annotation declares, and a call through it. */
    public void ownLogger() {
        log.info("count is {}", count);
    }

    /** SUBJECT D: the same accessors, one hop away, on the library type. */
    public String libraryAccessors(Catalog c) {
        c.setName("y");
        return c.getName() + c.getSize();
    }

    /** SUBJECT E: a boolean accessor on the library type. */
    public boolean libraryBooleanAccessor(Catalog c) {
        return c.isArchived();
    }

    /**
     * CONTROL: the library writes `getLabel` out AND annotates the field. One method
     * exists, and it is the source one. This must resolve to the hand-written
     * declaration, not to a generated twin of it.
     */
    public String libraryShadowedAccessor(Catalog c) {
        return c.getLabel();
    }

    /** CONTROL: a hand-written library method. */
    public String libraryHandWritten(Catalog c) {
        return c.describe();
    }

    /**
     * NOT COVERED, and pinned here so the gap stays visible rather than silent: the
     * builder the class annotation declares needs a synthesized NESTED TYPE as well as
     * methods. These sites are expected to stay unresolved.
     */
    public Catalog libraryBuilder() {
        return Catalog.builder().name("z").size(3).build();
    }

    public static void main(String[] args) {
        Lombok m = new Lombok();
        m.handWritten();
        m.ownAccessors();
        m.ownBooleanAccessor();
        m.ownLogger();
        Catalog c = m.libraryBuilder();
        m.libraryAccessors(c);
        m.libraryBooleanAccessor(c);
        m.libraryShadowedAccessor(c);
        m.libraryHandWritten(c);
    }
}
