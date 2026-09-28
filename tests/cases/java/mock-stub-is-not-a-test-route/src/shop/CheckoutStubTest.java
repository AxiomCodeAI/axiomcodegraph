package shop;

import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.mockito.Mock;

public class CheckoutStubTest {
    @Mock private PriceService prices;

    @Test
    public void stubsThePrice() {
        when(prices.price(Ids.first())).thenReturn(5);
        verify(prices).price(1);
        doReturn(3).when(prices).price(2);
    }
}
