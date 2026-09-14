package testcases.config;

/**
 * Engine test — MESSAGE-BROKER LISTENERS AND gRPC SERVICES.
 *
 * Both are pure framework entry points: the broker or the gRPC server calls these
 * methods, no client call site does. Without this layer the whole consumer and the
 * whole service body look like dead code.
 *
 * What this pins down, and why each line was a measured gap before it:
 *
 *   @KafkaListener / @RabbitListener on a METHOD   -> entry point (kind `queue`)
 *   @KafkaListener on a CLASS + @KafkaHandler      -> every handler is an entry point
 *   topics = "${app.topics.orders}"                -> the KEY BINDS TO THE LISTENER.
 *       A placeholder inside an annotation argument other than @Value used to bind to
 *       nothing, so "I changed app.queues.mail — what breaks?" answered nothing when
 *       the answer is the listener that subscribes to it.
 *   a gRPC impl extending a GENERATED base         -> entry point (kind `grpc_service`)
 *       Keyed on the SUPERTYPE's name suffix (…ImplBase), because the generated class
 *       name comes from the .proto and cannot be enumerated. There is no annotation on
 *       the method to key on, and the base is a CLIENT type, so neither the callback
 *       name list nor the library-supertype test could reach it.
 *   PRODUCER <-> CONSUMER through a shared key     -> app.topics.orders reaches BOTH
 *       OrderProducer#publish and OrderConsumer#onOrder. That is the cross-component
 *       link the config-yaml projection header describes, obtained via the config key.
 *       Matching a LITERAL topic string on both sides is NOT done — see the note at
 *       the bottom.
 */

@interface Component { }
@interface Service { }
@interface Autowired { }
@interface Value { String value(); }
@interface KafkaListener { String[] topics(); String groupId() default ""; }
@interface KafkaHandler { }
@interface RabbitListener { String[] queues(); }
@interface RabbitHandler { }
@interface GrpcService { }

@Component
class Handler {
    void handle(String p) { }
}

/** Kafka listener on a method, subscribing to a topic named by config. */
@Component
class OrderConsumer {
    @Autowired Handler handler;

    @KafkaListener(topics = "${app.topics.orders}", groupId = "g1")
    void onOrder(String payload) { handler.handle(payload); }
}

/** Class-level listener: the broker dispatches to the @KafkaHandler methods by type. */
@KafkaListener(topics = "batch")
@Component
class BatchConsumer {
    @KafkaHandler void onText(String s) { }
    @KafkaHandler void onCount(Integer i) { }
}

/** The other side of the same topic — linked to the consumer by the shared key. */
@Service
class OrderProducer {
    @Value("${app.topics.orders}") String topic;
    void publish(String p) { send(topic, p); }
    void send(String t, String p) { }
}

@Component
class MailConsumer {
    @RabbitListener(queues = "${app.queues.mail}")
    void onMail(String m) { }

    @RabbitHandler
    void onFallback(Object o) { }
}

/** Stands in for the protoc-generated abstract base. */
abstract class GreeterImplBase {
    public void sayHello(String req, Object observer) { }
}

@GrpcService
class GreeterService extends GreeterImplBase {
    @Autowired Handler handler;

    @Override
    public void sayHello(String req, Object observer) { handler.handle(req); }
}

// NOT MODELLED, deliberately: matching a LITERAL topic string on the producer side
// (send("orders", …)) to a literal on the consumer side (@KafkaListener(topics="orders")).
// Joining two string literals across components needs a service-identity model —
// which component is which deployable — that this layer does not have, and guessing it
// would fabricate edges between unrelated components that happen to share a topic name.
// Routing the link through the CONFIG KEY, as OrderProducer/OrderConsumer do above, is
// the case that is decidable, and it is the case real services are written in.
