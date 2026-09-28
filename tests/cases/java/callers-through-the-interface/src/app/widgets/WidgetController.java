package app.widgets;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class WidgetController {
    @Autowired
    private WidgetService widgetService;

    @GetMapping("/widgets")
    public String get(String name) {
        return widgetService.build(name);
    }
}
