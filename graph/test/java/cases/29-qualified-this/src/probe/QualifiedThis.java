package probe;

/**
 * `Outer.this.m()` must reach the member of the type it NAMES, not of the innermost enclosing one.
 *
 * Every inner member here deliberately COLLIDES with an outer one by name and arity, because a name
 * clash is exactly what forces the qualification to be written in the first place — a fixture whose
 * inner and outer members had different names would be passed by a resolver that ignores the
 * qualifier entirely. `only()` is the control: declared once in the whole file, on the outer type,
 * so a missing edge to it cannot be blamed on ambiguity.
 */
public class QualifiedThis {

    String tag()  { return "outer"; }
    String only() { return "outer-only"; }          // declared exactly once, on the outer type

    class Inner {
        String tag() { return "inner"; }            // same name, same arity, different type

        String viaQualifiedThis()        { return QualifiedThis.this.tag();  }  // -> QualifiedThis#tag
        String viaQualifiedThisNoClash() { return QualifiedThis.this.only(); }  // -> QualifiedThis#only
        String viaPlainThis()            { return this.tag();                }  // -> Inner#tag
        String viaUnqualified()          { return tag();                     }  // -> Inner#tag

        class Deeper {
            String tag() { return "deeper"; }       // a third tag(), two levels in

            String twoLevelsOut() { return QualifiedThis.this.tag(); }  // -> QualifiedThis#tag
            String oneLevelOut()  { return Inner.this.tag();         }  // -> Inner#tag
            String ownTag()       { return this.tag();               }  // -> Deeper#tag
        }
    }

    /** `Outer.this` written in Outer itself is legal and means plain `this`. */
    String selfQualified() { return QualifiedThis.this.tag(); }          // -> QualifiedThis#tag

    Runnable anon() {
        return new Runnable() {
            public void run() { QualifiedThis.this.tag(); }              // -> QualifiedThis#tag
        };
    }

    public static void main(String[] args) {
        QualifiedThis o = new QualifiedThis();
        Inner i = o.new Inner();
        System.out.println(i.viaQualifiedThis() + i.viaQualifiedThisNoClash()
                         + i.viaPlainThis() + i.viaUnqualified() + o.selfQualified());
        Inner.Deeper d = i.new Deeper();
        System.out.println(d.twoLevelsOut() + d.oneLevelOut() + d.ownTag());
        o.anon().run();
    }
}
