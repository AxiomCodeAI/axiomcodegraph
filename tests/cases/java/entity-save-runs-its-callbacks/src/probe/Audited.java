package probe;

import jakarta.persistence.EntityListeners;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.PreUpdate;

/** A mapped superclass: its own callbacks and the listeners it names apply to every entity below it. */
@MappedSuperclass
@EntityListeners(AuditTrail.class)
public abstract class Audited {
    long version;

    @PreUpdate
    void touch() { version++; }
}
