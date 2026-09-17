package probe;

/**
 * A LOCAL SHADOWS A FIELD ONLY WHERE IT IS IN SCOPE (JLS 6.3).
 *
 * The parser classified a simple name against every local name declared anywhere in the method, so
 * a field read above a later local of the same name, or after the sibling block that declared one,
 * was recorded LOCAL_VARIABLE and the field dependency left the IR entirely. javac disagrees:
 * renaming the field makes exactly the lines commented FIELD below fail to compile.
 *
 * The field and the local are given DIFFERENT types with DISJOINT methods, so a misclassified
 * receiver cannot resolve at all, and this case's goldens move when the classification does.
 */
public class Shadow {

    private final FieldSide value = new FieldSide();
    private final FieldSide count = new FieldSide();
    private final FieldSide index = new FieldSide();
    private final FieldSide error = new FieldSide();
    private final FieldSide shape = new FieldSide();

    /** The report: the field is read ABOVE a local of the same name. */
    String laterLocal() {
        String head = value.fromField();     // FIELD: no local `value` is in scope yet
        LocalSide value = new LocalSide();
        return head + value.fromLocal();     // the local
    }

    /** A local dies with its block, so a sibling statement reads the field. */
    String closedSiblingBlock() {
        String head;
        {
            LocalSide count = new LocalSide();
            head = count.fromLocal();        // the local, inside its own block
        }
        return head + count.fromField();     // FIELD: that block closed
    }

    /** A `for` header declares into its statement, not into the rest of the method. */
    String forHeader() {
        String head = "";
        for (LocalSide index = new LocalSide(); head.isEmpty(); ) {
            head = index.fromLocal();        // the loop local
        }
        return head + index.fromField();     // FIELD
    }

    /** A catch parameter is scoped to its clause. */
    String catchParameter() {
        try {
            throw new IllegalStateException("x");
        } catch (RuntimeException error) {
            return String.valueOf(error.getMessage());
        } finally {
            shape.fromField();               // FIELD, in a finally that sees no binding
        }
    }

    /** A pattern variable binds from the pattern onward; the read above it is the field. */
    String patternVariable(Object o) {
        String head = shape.fromField();     // FIELD
        if (o instanceof LocalSide shape) {
            return head + shape.fromLocal(); // the binding
        }
        return head;
    }

    /** CONTROL: a field read in a method that declares no local of that name at all. */
    String plain() {
        return count.fromField();
    }

    /** CONTROL: a genuine local, read after its own declaration. */
    String after() {
        LocalSide count = new LocalSide();
        return count.fromLocal();
    }
}
