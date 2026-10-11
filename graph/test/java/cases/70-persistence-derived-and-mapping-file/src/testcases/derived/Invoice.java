package testcases.derived;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.NamedQuery;

@Entity
@NamedQuery(name = "Invoice.byTotal", query = "SELECT i FROM Invoice i WHERE i.total > :min")
public class Invoice {
    @Id Long id;
    String status;
    long total;
}
