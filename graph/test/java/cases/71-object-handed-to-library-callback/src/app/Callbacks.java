package app;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.function.Function;
import java.util.function.Predicate;

/**
 * A named class handed to a library method is called back by the library: no client call
 * site names its methods. No library is staged, so the supertypes are external and the
 * @Override annotation is what says a supertype declares the method.
 */
class Callbacks {
    static class ByLength implements Comparator<String> {
        @Override
        public int compare(String a, String b) { return Rules.shorter(a, b); }

        // control: not an override, the library cannot call it
        public int other(String a) { return Rules.helper(a); }

        // control: an Object member is never fanned
        @Override
        public String toString() { return Rules.shown("by length"); }
    }

    static class NonEmpty implements Predicate<String> {
        @Override
        public boolean test(String s) { return Rules.valid(s); }
    }

    // a class that writes no @Override: its public methods are the candidates, a private one is not
    static class Shouty implements Function<String, String> {
        public String apply(String s) { return Rules.loud(s); }

        private String quiet(String s) { return Rules.soft(s); }
    }

    // control: a value class under a Serializable base writes no @Override either, and a marker
    // interface declares nothing a library could call back
    static class Base implements Serializable {
        public String code() { return Rules.shown("base"); }
    }

    static class Item extends Base {
        public String label() { return Rules.shown("item"); }
    }

    // control: a class with no external ancestor
    static class Plain {
        public boolean check(String s) { return Rules.local(s); }
    }

    void sortNamed(List<String> xs) {
        xs.sort(new ByLength());
    }

    void sortHeld(List<String> xs) {
        ByLength cmp = new ByLength();
        xs.sort(cmp);
    }

    boolean filterNamed(List<String> xs) {
        return xs.stream().anyMatch(new NonEmpty());
    }

    String mapNamed(List<String> xs) {
        return xs.stream().map(new Shouty()).findFirst().orElse("");
    }

    // control: a value passed along, not created for the call, is not a hand-off
    void passAlong(List<String> xs, ByLength given) {
        xs.sort(given);
    }

    // control: the anonymous form is reached by containment, as before
    void sortAnonymous(List<String> xs) {
        xs.sort(new Comparator<String>() {
            @Override
            public int compare(String a, String b) { return Rules.known(a) ? 1 : 0; }
        });
    }

    // control: handed to CLIENT code, which holds the call on it
    void keepLocal(List<String> xs) {
        consume(new ByLength());
        new ArrayList<Object>().add(new Plain());
        new ArrayList<Object>().add(new Item());
        new ArrayList<Object>().add(new Base());
    }

    void consume(Comparator<String> c) { c.compare("a", "b"); }
}
