package probe;

import org.springframework.data.mongodb.repository.MongoRepository;

/**
 * SUBJECT A: a Spring Data repository. No annotation, no implementing class, and the
 * base is in the persistence framework, which is NOT passed as --library. Nothing
 * about this interface resolves to anything: the extends-clause name is the only
 * evidence that the container will register a proxy for it.
 */
public interface OrderRepository extends MongoRepository<Order, String> {
    Order findByName(String name);
}
