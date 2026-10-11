package testcases.derived;

import jakarta.persistence.EntityManager;

import java.util.List;

public class InvoiceDao {
    EntityManager em;

    // declared in META-INF/orm.xml
    List<Invoice> byStatus(String s) {
        return em.createNamedQuery("Invoice.byStatus", Invoice.class).setParameter("status", s).getResultList();
    }

    // control: declared by @NamedQuery on the entity
    List<Invoice> byTotal(long min) {
        return em.createNamedQuery("Invoice.byTotal", Invoice.class).setParameter("min", min).getResultList();
    }

    // control: declared nowhere
    List<Invoice> byNothing() {
        return em.createNamedQuery("Invoice.byNothing", Invoice.class).getResultList();
    }
}
