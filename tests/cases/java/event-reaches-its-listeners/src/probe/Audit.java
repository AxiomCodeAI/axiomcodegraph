package probe;

import org.springframework.context.event.EventListener;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.stereotype.Component;

@Component
public class Audit {
    @EventListener
    public void on(OrderPlaced e) { record(e.id); }

    @EventListener
    public void onExpress(ExpressOrderPlaced e) { record(e.id); }

    @TransactionalEventListener
    public void afterCommit(OrderPlaced e) { record("t"); }

    // the event type named on the annotation, no parameter
    @EventListener(classes = OrderCancelled.class)
    public void onCancelled() { record("c"); }

    // several types named on the annotation, in the array form
    @EventListener({OrderPlaced.class, OrderCancelled.class})
    public void onEither() { record("either"); }

    // control: listens for a type nothing publishes
    @EventListener
    public void onWidget(WidgetBuilt w) { record("w"); }

    // control: the right parameter type, but not a listener
    public void direct(OrderPlaced e) { record(e.id); }

    void record(String s) { }
}
