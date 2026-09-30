package demo.order;
import org.junit.jupiter.api.Test;
public class OrderLoadTest {
    @Test
    void loadsOne() {
        new OrderService(null).load("o-1");
    }
}
