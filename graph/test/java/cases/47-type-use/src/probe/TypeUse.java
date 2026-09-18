package probe;

import java.util.List;
import java.util.Map;

/**
 * One reference to Marker in every context the type_use relation carries, so "what breaks if I
 * change this type" can be answered per context rather than as a count of mentions. The golden
 * records the CONTEXT and the DEPTH on each row: depth 0 is the type as written, depth >= 1 is a
 * type argument of the one above it, and both are uses of the type named.
 */
public class TypeUse extends Base implements Tagged {   // SUPER_TYPE, IMPLEMENTS_INTERFACE

    Marker field;                                        // FIELD_TYPE
    Map<String, Marker> generic;                         // FIELD_TYPE depth 0 (Map) and depth 1 (Marker)
    Marker[] array;                                      // FIELD_TYPE, with array dimensions

    Marker returns() { return null; }                    // METHOD_RETURN
    void param(Marker m) { }                             // METHOD_PARAM
    void generics(List<Marker> ms) { }                   // METHOD_PARAM depth 0 and depth 1
    void thrown() throws MarkerException { }             // THROWS_CLAUSE

    Object created()      { return new Marker(); }       // OBJECT_CREATION_TYPE
    Object createdArray() { return new Marker[3]; }      // ARRAY_CREATION_TYPE
    Marker cast(Object o) { return (Marker) o; }         // CAST_EXPRESSION
    boolean tested(Object o) { return o instanceof Marker; }          // INSTANCEOF_TYPE
    String pattern(Object o) { return o instanceof Marker m ? "y" : "n"; }  // INSTANCEOF_TYPE, bound

    void local() { Marker m = null; }                    // LOCAL_VARIABLE
    void catches() { try { thrown(); } catch (MarkerException e) { } }     // LOCAL_VARIABLE (catch)

    @Tag(Marker.class) void annotated() { }              // ANNOTATION_TYPE (Tag), ANNOTATION_PARAM

    static <T extends Marker> T bounded(T t) { return t; }    // METHOD_TYPE_PARAM_BOUND
    static class Box<T extends Marker> { }                    // TYPE_PARAM_BOUND

    /** A type no staged IR declares. It must be a DECLARED UNKNOWN, not a dropped row. */
    java.sql.Connection unresolvable;                    // FIELD_TYPE, resolves to nothing

    /** The control: a METHOD and a FIELD whose simple name is the type's. Neither is a type use. */
    int Marker;
    int Marker() { return Marker; }
}

class Base { }
interface Tagged { }
class Marker { }
class MarkerException extends Exception { }

@interface Tag { Class<?> value(); }
