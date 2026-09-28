package app.gen;

// Written by an annotation processor into Gradle's output directory: not the project's source.
// Its only call is to the JDK, so the bytecode oracle scores nothing here; if the parser read
// this file, the .edges golden would gain its boundary_lib row.
public class GeneratedStage {
    public String label(String name) {
        return name.trim();
    }
}
