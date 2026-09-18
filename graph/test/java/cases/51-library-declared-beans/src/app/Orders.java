package app;

import dep.Greeter;
import dep.Plain;
import dep.Sink;
import dep.WidgetCache;
import dep.WidgetStore;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * LIBRARY-DECLARED BEANS: a dependency supplied through --library declares beans with
 * the same annotations the application uses, and the application injects them. The
 * dependency's annotations are staged and readable, so each of these slots has an
 * answer; a slot with exactly one candidate has a unique one.
 *
 * The controls are `plain` (a dependency type that is not a bean), `sink` (two
 * dependency beans fit it, so it must stay a fan) and `helper` (a client bean).
 */
@Service
public class Orders {

    /** SUBJECT A: an INTERFACE declared by the dependency, one implementation. */
    @Autowired private Greeter greeter;

    /** SUBJECT B: a CONCRETE class declared by the dependency. */
    @Autowired private WidgetStore store;

    /** SUBJECT C: a type the dependency contributes through a @Bean factory method. */
    @Autowired private WidgetCache cache;

    /** CONTROL D: a dependency type that carries no stereotype. Stays unsatisfied. */
    @Autowired private Plain plain;

    /** CONTROL F: two dependency beans fit, so the slot stays a fan. */
    @Autowired private Sink sink;

    /** CONTROL E: a client bean. */
    @Autowired private LocalHelper helper;

    public String viaInterface(String who) {
        return greeter.greet(who);
    }

    public String viaConcrete(String id) {
        return store.find(id);
    }

    public String viaFactoryBean(String id) {
        return cache.get(id);
    }

    public String viaPlain() {
        return plain.run();
    }

    public void viaFan(String line) {
        sink.write(line);
    }

    public String viaClientBean() {
        return helper.help();
    }
}
