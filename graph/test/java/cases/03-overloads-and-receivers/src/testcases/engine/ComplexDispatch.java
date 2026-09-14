package testcases.engine;

import java.util.HashMap;
import java.util.Map;

/**
 * COMPLEX — overload disambiguation, boxing/widening, static & field-access receivers,
 * mixing INTERNAL (client) and EXTERNAL (JDK) targets.
 *
 * EXPECTED callee links:
 *   log(String)/log(String,Throwable)/log(int) — each call picks the arity+type match
 *   emit(Object)/emit(String) — a String arg is applicable to BOTH (kept as a set)
 *   Math.max(int,int), Integer.parseInt(String), String.valueOf(..)  — lib static
 *   cache.put(k, 42) — lib Map.put ; the int 42 boxes to Integer (Object param, carve-out)
 *   this.sink.accept(..) — field-access receiver -> client Sink.accept
 */
public class ComplexDispatch {

    interface Sink { void accept(String s); }
    private final Sink sink = new Sink() { public void accept(String s) {} };
    private final Map<String, Integer> cache = new HashMap<>();

    // client overloads — same name, distinguished by arity and argument type
    void log(String msg) {}
    void log(String msg, Throwable t) {}
    void log(int code) {}

    // client overloads where a String arg fits both (applicable-set)
    String emit(Object o) { return "o"; }
    String emit(String s) { return "s"; }

    void internalOverloads(Throwable err) {
        log("hello");            // -> client log(String)
        log("boom", err);        // -> client log(String, Throwable)
        log(500);                // -> client log(int)
        emit("text");            // -> client emit(String) AND emit(Object) (both applicable)
    }

    int jdkStatics(String numText, int a, int b) {
        int m = Math.max(a, b);              // lib Math.max(int,int)
        int n = Integer.parseInt(numText);   // lib Integer.parseInt(String)
        String s = String.valueOf(m);        // lib String.valueOf(int)
        return m + n + s.length();           // s.length -> lib String.length
    }

    void boxingAndFields(String key) {
        cache.put(key, 42);      // lib Map.put(K,V) ; 42 boxes to Integer, V erases to Object
        this.sink.accept(key);   // field-access receiver -> client Sink.accept (+ anon impl via CHA)
    }
}
