package app;

import app.build.StageBuilder;
import app.lib.build.LibStep;

public class Pipeline {
    public String run(String name) {
        String staged = new StageBuilder().stage(name);
        return new LibStep().apply(staged);
    }
}
