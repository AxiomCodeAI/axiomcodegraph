package shop;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

public class CheckoutTest {
    @Test
    public void totalsWithTheRealPrice() {
        assertEquals(3, new Checkout(new PriceService()).total(1));
    }
}
