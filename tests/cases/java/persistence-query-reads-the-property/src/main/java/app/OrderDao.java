package app;
import java.util.List;
import jakarta.persistence.EntityManager;
public class OrderDao {
    EntityManager em;
    List<Order> byStatus(String s) { return em.createNamedQuery("Order.byStatus", Order.class).setParameter("status", s).getResultList(); }
    List<Order> byTotal(long min) { return em.createNamedQuery("Order.byTotal", Order.class).setParameter("min", min).getResultList(); }
}
