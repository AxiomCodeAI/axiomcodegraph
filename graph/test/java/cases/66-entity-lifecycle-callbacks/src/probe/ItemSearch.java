package probe;

import jakarta.persistence.PostPersist;

public class ItemSearch {
    @PostPersist
    void index(Object entity) { }
}
