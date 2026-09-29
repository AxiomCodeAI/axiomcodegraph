package probe;

import jakarta.persistence.PostRemove;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;

public class ItemStamps {
    @PrePersist
    void onCreate(Item item) { stamp(item); }

    @PreUpdate
    void onUpdate(Item item) { stamp(item); }

    @PostRemove
    void onRemoved(Item item) { }

    void stamp(Item item) { }
}
