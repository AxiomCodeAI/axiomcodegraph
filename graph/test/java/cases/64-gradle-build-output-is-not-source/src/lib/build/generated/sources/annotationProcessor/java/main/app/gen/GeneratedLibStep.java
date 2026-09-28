package app.gen;

// A Gradle MODULE's output (beside lib/build.gradle.kts): skipped like the root project's.
public class GeneratedLibStep {
    public String label(String name) {
        return name.strip();
    }
}
