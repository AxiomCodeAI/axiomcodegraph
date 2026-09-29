package probe;

import jakarta.persistence.Entity;
import jakarta.persistence.EntityListeners;
import jakarta.persistence.PostRemove;
import jakarta.persistence.PrePersist;

@Entity
@EntityListeners({ItemStamps.class, ItemSearch.class})
public class Item extends Audited {
    String name;

    @PrePersist
    void beforeInsert() { name = name == null ? "" : name; }

    @PostRemove
    void gone() { }

    void rename(String n) { name = n; }
}
