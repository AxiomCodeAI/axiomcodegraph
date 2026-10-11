package app.jpa;

import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.EntityListeners;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;

@Entity
@EntityListeners(WidgetAudit.class)
@Documented(by = Unregistered.class)
public class Widget {
    @Id Long id;
    @Convert(converter = PriceConverter.class) Price price;

    @PrePersist void stamp() { }
    // CONTROL: no callback annotation
    void touch() { }
}
