package probe;

import jakarta.persistence.PostPersist;

public class AuditTrail {
    @PostPersist
    void recorded(Object entity) { }
}
