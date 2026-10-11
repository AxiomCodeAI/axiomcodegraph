package app;

import dep.Checks;
import dep.Matcher;

/**
 * The dependency is staged, so the override is known from its declaration: no @Override
 * is needed, and a method it does not declare is not a callback.
 */
class Verifier {
    static class IsValid implements Matcher<String> {
        public boolean matches(String s) { return Rules.valid(s); }

        // control: the dependency does not declare it
        public int size(String s) { return Rules.helper(s); }
    }

    String check() {
        return Checks.argThat(new IsValid());
    }
}
