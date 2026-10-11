package probe;

import lombok.extern.slf4j.Slf4j;

/** #1408: the logger field has the type the annotation fixes. */
@Slf4j
public class Worker {
    private final org.slf4j.Logger audit = org.slf4j.LoggerFactory.getLogger("audit");

    public void work() {
        log.info("x");
        audit.info("x");
        new Runnable() {
            public void run() {
                log.debug("inner");
            }
        }.run();
    }
}
