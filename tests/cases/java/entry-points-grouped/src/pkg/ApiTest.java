package pkg;

import org.junit.Test;

// Three test entry points. A runner invokes them, so they are entry points too — but they are not a surface
// the outside world calls, and explaining each one is what buried the answer on a real application (#1036).
public class ApiTest {
    @Test
    public void listsOrders() { new Api().listOrders(); }

    @Test
    public void getsOneOrder() { new Api().getOrder("1"); }

    @Test
    public void createsOrder() { new Api().createOrder("{}"); }
}
