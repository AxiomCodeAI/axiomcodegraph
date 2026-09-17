package testcases.destinations;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

/**
 * Producer and consumer in one tree, which is what makes this testable without two
 * repositories. Neither calls the other: the only thing linking them is the topic.
 */
@Component
public class Messaging {

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final String auditTopic;

    public Messaging(KafkaTemplate<String, String> kafkaTemplate,
                     @Value("${app.topics.audit}") String auditTopic) {
        this.kafkaTemplate = kafkaTemplate;
        this.auditTopic = auditTopic;
    }

    /** a constant destination */
    public void publishCreated(String payload) {
        kafkaTemplate.send(Routes.ORDERS_CREATED, payload);
    }

    /** a configured destination */
    public void publishAudit(String payload) {
        kafkaTemplate.send(auditTopic, payload);
    }

    /** a destination nothing in this tree consumes — reported, not guessed */
    public void publishElsewhere(String payload) {
        kafkaTemplate.send("orders.archived", payload);
    }

    @KafkaListener(topics = "orders.created")
    public void onCreated(String payload) {
        record(payload);
    }

    @KafkaListener(topics = "${app.topics.audit}")
    public void onAudit(String payload) {
        record(payload);
    }

    void record(String payload) {
    }
}
