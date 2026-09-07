package expressions;

/**
 * A comment inside a ternary must not move its operands.
 *
 * `line_comment` and `block_comment` are NAMED nodes in tree-sitter-java, so reading
 * `namedChildren[0..2]` positionally hands back the comment as an operand. Under that read the
 * `commentBeforeQuestion` shape emitted `whenTrue()` with edgeRole TERNARY_FALSE and dropped
 * `whenFalse()` altogether: not a weaker answer but a wrong one, since the engine unions the two
 * branch types to type a ternary receiver.
 *
 * Each shape below carries the same two calls, so the expected row set is identical for all of
 * them and any positional read fails on at least one.
 */
public class CommentedTernary {

    String whenTrue() { return "t"; }
    String whenFalse() { return "f"; }
    boolean flag;

    /** The control: no comment anywhere, correct under either read. */
    String noComment() {
        return flag ? whenTrue() : whenFalse();
    }

    /** A comment between the condition and the `?` — the shape that produced a WRONG role. */
    String commentBeforeQuestion() {
        return flag //
            ? whenTrue()
            : whenFalse();
    }

    /** A comment between the `?` arm and the `:` — dropped the false branch. */
    String commentAfterQuestion() {
        return flag
            ? whenTrue() //
            : whenFalse();
    }

    /** A block comment, which is a named node just as a line comment is. */
    String blockComment() {
        return flag /* why */ ? whenTrue() : whenFalse();
    }

    /** A comment in every position at once. */
    String commentEverywhere() {
        return flag // cond
            ? whenTrue() // yes
            : whenFalse(); // no
    }

    /** Nested ternaries, each with a comment, so a shift in the outer cannot hide in the inner. */
    String nested() {
        return flag //
            ? whenTrue()
            : flag //
                ? whenTrue()
                : whenFalse();
    }
}
