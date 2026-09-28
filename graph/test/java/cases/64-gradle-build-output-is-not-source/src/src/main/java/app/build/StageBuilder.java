package app.build;

// A source package named `build`, in a Gradle project: it has no build script beside it, so it is source.
public class StageBuilder {
    public String stage(String name) {
        return name + "-staged";
    }
}
