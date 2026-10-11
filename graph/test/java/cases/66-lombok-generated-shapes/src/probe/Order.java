package probe;

import lombok.Builder;

/** #1405: builder(), the setters, build() and toBuilder() of a synthesized OrderBuilder. */
@Builder(toBuilder = true)
public class Order {
    private String sku;
    private int qty;
    private static int created;

    public void ship() {
    }
}
