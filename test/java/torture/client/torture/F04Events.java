package torture;

// f04 — EVENT-DRIVEN. The target of a dispatch is never written next to the call: it is registered
// somewhere else, stored in a field, a list, or a map keyed by type, and invoked later.

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import dep.Bus;
import dep.Event;
import dep.Handler;

public class F04Events {

    // a CLIENT implementation of a LIBRARY-declared callback: the library declaration has no body,
    // so a call through the library type must fan to this
    static class AuditHandler implements Handler {
        @Override public void handle(Event e) { record(e.name()); }
        static void record(String s) { }
    }
    static class MetricHandler implements Handler {
        @Override public void handle(Event e) { count(); }
        static void count() { }
    }

    // a client-declared listener interface with two implementations
    interface Listener { void onFired(String what); }
    static class LogListener implements Listener { public void onFired(String w) { write(w); } static void write(String s) { } }
    static class NoopListener implements Listener { public void onFired(String w) { } }

    private final List<Listener> listeners = new ArrayList<>();
    private Listener single;
    private final Map<String, Consumer<String>> byTopic = new HashMap<>();

    void add(Listener l) { listeners.add(l); }
    void setSingle(Listener l) { this.single = l; }

    // dispatch through a LIST of a client interface — the sound answer is both implementations
    void fireAll(String what) { for (Listener l : listeners) l.onFired(what); }
    // dispatch through a FIELD holding one of two implementations written elsewhere
    void fireSingle(String what) { single.onFired(what); }
    // dispatch through a MAP of lambdas keyed at runtime
    void fireTopic(String topic, String what) { byTopic.get(topic).accept(what); }
    // the library does the dispatching: publish() calls handle() on whatever was registered
    void viaLibraryBus(Bus bus, Event e) { bus.publish(e); }
    // a library method returning a library interface, then a client-implemented method on it
    void viaLibraryReturn(Bus bus, Event e) { bus.first().handle(e); }
    // a default method declared by the library interface, called on a client implementation
    String viaLibraryDefault(AuditHandler h) { return h.describe(); }

    void wire(Bus bus) {
        bus.register(new AuditHandler());
        bus.register(new MetricHandler());
        add(new LogListener());
        add(new NoopListener());
        setSingle(new LogListener());
        byTopic.put("a", s -> LogListener.write(s));
        byTopic.put("b", new NoopListener()::onFired);   // bound method reference on a fresh instance
    }
}
