package testcases.springoracle;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * @Bean factory methods: the bean's TYPE is the method's declared return type and
 * its NAME is the method name unless given. The method's parameters are themselves
 * injection points resolved from the context.
 */
@Configuration
class AppConfig {

    @Bean
    Clock clock() { return new SystemClock(); }

    @Bean("audit")
    AuditSink auditSink(OrderRepo repo) { return new LoggingAuditSink(repo); }
}

interface Clock { long now(); }

class SystemClock implements Clock {
    public long now() { return 0L; }
}

interface AuditSink { void record(String event); }

class LoggingAuditSink implements AuditSink {
    private final OrderRepo repo;
    LoggingAuditSink(OrderRepo repo) { this.repo = repo; }
    public void record(String event) { repo.find(event); }
}
