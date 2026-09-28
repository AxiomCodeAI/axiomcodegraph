package app.widgets;

public class WidgetReport {
    private final WidgetService service;

    public WidgetReport(WidgetService service) {
        this.service = service;
    }

    public String line(String name) {
        return service.build(name);
    }
}
