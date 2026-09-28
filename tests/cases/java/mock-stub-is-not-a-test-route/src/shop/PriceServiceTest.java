package shop;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

public class PriceServiceTest {
    @Test
    public void runsThePrice() {
        PriceService prices = new PriceService();
        assertEquals(2, prices.price(1));
    }
}
