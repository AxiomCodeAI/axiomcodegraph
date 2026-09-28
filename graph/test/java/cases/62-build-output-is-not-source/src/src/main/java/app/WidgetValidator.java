package app;

import app.build.StepBuilder;
import app.site.PageRenderer;

public class WidgetValidator {
    public boolean check(String name) {
        new PageRenderer().render(name);
        new StepBuilder().next(name);
        return name != null && !name.isEmpty();
    }
}
