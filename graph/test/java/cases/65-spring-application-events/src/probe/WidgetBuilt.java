package probe;

import org.springframework.context.ApplicationEvent;

// an unrelated event type: nothing in this case publishes it
public class WidgetBuilt extends ApplicationEvent {
    public WidgetBuilt(Object source) { super(source); }
}
