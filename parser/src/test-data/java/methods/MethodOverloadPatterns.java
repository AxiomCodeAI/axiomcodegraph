package com.axiom.test.overloads;

import java.util.List;

/**
 * Overload-linking test.
 *
 * `process` is overloaded 4 ways (arity 0, 1-int, 1-String, 2). The two arity-1
 * overloads share an arity but differ in parameter type, so they MUST still be
 * assigned distinct method hashes. `combine` and `pick` are overloaded 2 ways each.
 *
 * The parser must:
 *   - give every overload a distinct method hash,
 *   - link every parameter back to its OWN overload (no cross-linking between
 *     same-named overloads),
 *   - report parameterCount matching the number of linked parameters.
 */
public class MethodOverloadPatterns {

    // process/0
    public void process() { }

    // process/1 (int)
    public void process(int value) { }

    // process/1 (String) — same arity, different type: distinct hash required
    public void process(String value) { }

    // process/2
    public void process(int value, String label) { }

    // combine/2 (int, int)
    public int combine(int a, int b) {
        return a + b;
    }

    // combine/2 (String, String) — same arity, distinct signature
    public String combine(String a, String b) {
        return a + b;
    }

    // varargs overload — a distinct name, single overload
    public int sum(int... nums) {
        int total = 0;
        for (int n : nums) {
            total += n;
        }
        return total;
    }

    // generic overloads: scalar vs collection
    public <T> T pick(T only) {
        return only;
    }

    public <T> T pick(List<T> many) {
        return many.get(0);
    }
}
