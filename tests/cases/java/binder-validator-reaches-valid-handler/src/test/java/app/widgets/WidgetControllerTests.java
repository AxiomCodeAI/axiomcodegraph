package app.widgets;

import org.junit.jupiter.api.Test;

class WidgetControllerTests {
    private final WidgetController controller = new WidgetController();

    @Test
    void create() { controller.create(new Widget(), null); }

    @Test
    void check() { controller.check(new Widget(), null); }

    @Test
    void preview() { controller.preview(new Widget(), null); }
}
