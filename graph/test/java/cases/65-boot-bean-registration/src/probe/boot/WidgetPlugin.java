package probe.boot;

/** CONTROL: a META-INF/services provider, registered before this change. */
public class WidgetPlugin implements Plugin {
    public WidgetPlugin() {
        WidgetWire.plug();
    }

    @Override
    public void start() { }
}
