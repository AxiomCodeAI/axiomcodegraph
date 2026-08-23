// SHAPE 2 of the open d1 recall gap: static calls qualified by a TYPE NAME. Four variants, so a
// partial fix shows up as a partial pass rather than a vague "statics are flaky".
public class TypeQualifiedStatics {

    static class Helper {                       // (a) same-file, sibling type
        static String help(String s) { return s; }
    }
    static class Outer {                        // (b) nested-in-nested qualifier: Outer.Inner.stat()
        static class Inner { static String deep(String s) { return s; } }
    }
    static String self(String s) { return s; }   // (c) same-class, qualified by its own name

    String viaSiblingType(String s)  { return Helper.help(s); }
    String viaNestedType(String s)   { return Outer.Inner.deep(s); }
    String viaOwnTypeName(String s)  { return TypeQualifiedStatics.self(s); }
    String viaLibraryType(String s)  { return String.valueOf(Integer.parseInt(s)); }  // (d) library, control

    public static void main(String[] a) {
        TypeQualifiedStatics t = new TypeQualifiedStatics();
        System.out.println(t.viaSiblingType("a") + t.viaNestedType("b")
                         + t.viaOwnTypeName("c") + t.viaLibraryType("42"));
    }
}
