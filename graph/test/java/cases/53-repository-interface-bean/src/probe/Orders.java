package probe;

import dep.Store;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class Orders {

    @Autowired private OrderRepository repository;
    @Autowired private AuditRepository audit;
    @Autowired private Store store;

    /** SUBJECT A: a call through a directly declared repository. */
    public Order load(String name) {
        return repository.findByName(name);
    }

    /** SUBJECT B: a repository reached through a project-declared base. */
    public AuditRepository audit() {
        return audit;
    }

    /** CONTROL: a call through an ordinary library bean. */
    public String describe() {
        return store.describe();
    }
}
