package dep;

import java.util.ArrayList;
import java.util.List;

/** A stub dependency: enough of an event bus and a type hierarchy to exercise the client->library
 *  hand-off. Kilobytes, in the repo, so the boundary is testable without a gigabyte of real IR. */
public class Bus {
    private final List<Handler> handlers = new ArrayList<>();
    public void register(Handler h) { handlers.add(h); }
    public void publish(Event e) { for (Handler h : handlers) h.handle(e); }
    public Handler first() { return handlers.get(0); }
}
