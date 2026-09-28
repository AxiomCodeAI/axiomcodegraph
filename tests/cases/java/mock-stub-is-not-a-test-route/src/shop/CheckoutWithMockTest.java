package shop;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import org.mockito.Mock;

public class CheckoutWithMockTest {
    @Mock private PriceService prices;

    @Test
    public void totalsWithAMockedPrice() {
        assertEquals(1, new Checkout(prices).total(1));
    }
}
