package app.jpa;

import jakarta.persistence.PostPersist;

public class WidgetAudit {
    @PostPersist void saved(Widget w) { }
}
