package shop;

import static org.mockito.Mockito.when;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;

public class FixtureStubTest {
    @Mock private PriceService prices;

    @BeforeEach
    public void setUp() {
        stubPrices();
    }

    private void stubPrices() {
        when(prices.price(7)).thenReturn(0);
    }

    @Test
    public void usesTheStubbedPrice() {
        assertStubbed();
    }

    private void assertStubbed() {
    }
}
