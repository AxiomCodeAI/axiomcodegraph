package app.lib.build;

// The same inside a Gradle module: lib/src/main/java/app/lib/build is a package, not lib/build.
public class LibStep {
    public String apply(String name) {
        return name + "-applied";
    }
}
