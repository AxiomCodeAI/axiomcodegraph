package probe;

// Every shape a field access takes, with the controls that prove the relation is not a name match.
// The goldens record the TIER as well as the edge, so a receiver that cannot be typed shows up as
// a declared unknown rather than as silence (see .fields), and --oracle scores every row against
// getfield/putfield/getstatic/putstatic in the compiled class files.
public class FieldAccess {

    // ── the fields under test ────────────────────────────────────────────────
    int count;                       // read, written, compounded, incremented
    String label;                    // read through `this.`
    static int total;                // a static, read unqualified and through the type
    final Holder holder = new Holder();

    // ── READ, in every position a read is written ────────────────────────────
    int plainRead()        { return count; }
    String thisRead()      { return this.label; }
    int otherRead(FieldAccess o) { return o.count; }
    int staticRead()       { return total; }
    int typeQualified()    { return FieldAccess.total; }
    int chainedReceiver()  { return holder.value; }
    int receiverOfCall()   { return holder.describe().length(); }

    // ── WRITE ────────────────────────────────────────────────────────────────
    void plainWrite(int v)  { count = v; }
    void thisWrite(String s) { this.label = s; }
    void otherWrite(FieldAccess o, int v) { o.count = v; }
    void staticWrite(int v) { total = v; }

    // ── READWRITE: compound assignment, increment, decrement ─────────────────
    void compound(int v) { count += v; }
    void increment()     { count++; }
    void decrement()     { --count; }
    void compoundOther(FieldAccess o) { o.count *= 2; }

    // ── INHERITED RECEIVER: the field is declared two levels up ──────────────
    static class Root   { protected int depth; }
    static class Middle extends Root { }
    static class Leaf   extends Middle {
        int viaInherited()      { return depth; }
        void writeInherited()   { depth = 1; }
        int viaInheritedOther(Leaf l) { return l.depth; }
    }

    // ── SHADOWED FIELD: a subclass redeclares the name, and the two are two
    //    different storage locations. `super.shadow` is the base's, `shadow` is
    //    the subclass's. An impact answer that merges them is wrong, not vague.
    static class ShadowBase { int shadow = 1; }
    static class ShadowSub extends ShadowBase {
        int shadow = 2;
        int own()   { return shadow; }
        int base()  { return super.shadow; }
        int cast()  { return ((ShadowBase) this).shadow; }
    }

    // ── A FIELD READ THAT PRECEDES A SAME-NAMED LOCAL (#725) ─────────────────
    // `count` on the first line is the FIELD: no local of that name is in scope yet. The parser
    // classifies against the whole body's local names, so it records LOCAL_VARIABLE and the field
    // read is absent from the IR. The golden pins today's answer; when #725 lands this case is
    // what shows the edge appearing.
    int shadowedByLaterLocal() {
        if (count == 0) { return 31; }
        long count = 7L;
        return (int) count;
    }

    // ── ENUM CONSTANT (#760) ─────────────────────────────────────────────────
    enum Mode { FAST, SLOW }
    Mode qualifiedConstant() { return Mode.FAST; }
    boolean constantCompare(Mode m) { return m == Mode.SLOW; }
    // A case label is NOT a field access: javac compiles the switch through a $SwitchMap array,
    // so no getstatic names the constant, and the parser's kind for a label is TYPE for some arms
    // and FIELD for others (#760). The relation leaves case labels out, deliberately.
    int viaSwitch(Mode m) {
        switch (m) {
            case FAST: return 1;
            case SLOW: return 2;
            default:   return 0;
        }
    }

    // ── A RECEIVER THAT CANNOT BE TYPED: must be a DECLARED UNKNOWN ──────────
    // `java.awt.Point` is not staged (this suite stages no library IR), so `p` has no type and
    // `p.x` resolves to no field. The row is kept with tier ambiguous_unknown and field `-`.
    int unresolvableReceiver(java.awt.Point p) { return p.x; }

    // ── CONTROLS: the shapes that must NOT become field edges ────────────────
    // (1) a LOCAL of the same name as a field
    int localNamedCount() { int count = 9; return count; }
    // (2) a METHOD of the same name as a field
    int label() { return 7; }
    int callNamedLabel() { return label(); }
    // (3) a PARAMETER of the same name as a field
    int paramNamedCount(int count) { return count; }

    static class Holder {
        int value = 3;
        String describe() { return "h"; }
    }
}
