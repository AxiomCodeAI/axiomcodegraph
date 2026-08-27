package testcases.springoracle;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Repository;
import org.springframework.stereotype.Service;

/**
 * Engine test — validated against a LIVE SPRING CONTEXT.
 *
 * Every other check in this suite is the engine grading itself. This one is not:
 * tools/spring_oracle.sh boots THIS package in a real
 * AnnotationConfigApplicationContext, asks Spring for getBeanDefinitionNames() and
 * for the object actually sitting in each @Autowired field, and
 * tools/spring_oracle_diff.py scores bean_def and di_edge against that answer.
 * Spring's own resolution is the ground truth; nothing here is self-certified.
 *
 * Constructs chosen because they are where a bean-name or bean-resolution model
 * goes wrong:
 *   OrderRepo        ONE implementor is a bean, one is not -> unique resolution
 *   Notifier         TWO implementors are beans, one @Primary -> the container still
 *                    resolves it deterministically, and so must we (a genuinely
 *                    ambiguous injection is not a real app: Spring refuses to start)
 *   @Qualifier       names the NON-primary one              -> qualifier outranks primary
 *   @Component("…")  an EXPLICIT bean name                 -> not the class name
 *   URLHandler       TWO leading capitals                  -> Spring does NOT decapitalize
 *   HTTPClientPool   same, longer                          -> stays as written
 *   constructor injection with no annotation (Spring 4.3+ single-constructor rule)
 */

interface OrderRepo { String find(String id); }

@Repository
class JdbcOrderRepo implements OrderRepo {
    public String find(String id) { return "jdbc:" + id; }
}

/** Implements OrderRepo but is NOT a bean — the container would never inject it. */
class NoopOrderRepo implements OrderRepo {
    public String find(String id) { return "noop"; }
}

interface Notifier { void notifyOf(String msg); }

@Component
@Primary
class EmailNotifier implements Notifier {
    public void notifyOf(String msg) { }
}

@Component
class SmsNotifier implements Notifier {
    public void notifyOf(String msg) { }
}

@Service
class OrderService {
    @Autowired OrderRepo repo;                                  // unique -> narrows
    @Autowired Notifier anyNotifier;                            // two beans, one @Primary
    @Autowired @Qualifier("smsNotifier") Notifier picked;       // qualifier beats primary
    @Value("${app.name}") String appName;                       // a config key, not a bean

    String lookup(String id) { return repo.find(id); }
    void   ping()            { picked.notifyOf("ping"); }
    void   broadcast()       { anyNotifier.notifyOf("all"); }
}

@Service
class ReportService {
    private final OrderRepo repo;                               // ctor injection, no annotation
    ReportService(OrderRepo repo) { this.repo = repo; }
    String report(String id) { return repo.find(id); }
}

@Component("customName")
class Renamed { }

/** Two leading capitals: Introspector.decapitalize leaves the name ALONE. */
@Component
class URLHandler { }

@Component
class HTTPClientPool { }
