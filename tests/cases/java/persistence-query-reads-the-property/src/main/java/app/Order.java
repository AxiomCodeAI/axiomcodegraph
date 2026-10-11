package app;
import jakarta.persistence.*;
@Entity
@NamedQuery(name = "Order.byTotal", query = "SELECT o FROM Order o WHERE o.total > :min")
public class Order {
    @Id Long id;
    String status;
    long total;
}
