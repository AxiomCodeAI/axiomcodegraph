package probe.boot;

/** CONTROL: named only in a comment line of spring.factories. */
public class CommentedInitializer {
    public void initialize() {
        WidgetWire.loose();
    }
}
