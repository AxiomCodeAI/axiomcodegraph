package testcases.destinations;

/** Route and topic names shared as constants, the way a real codebase shares them. */
public final class Routes {
    public static final String ITEM = "/api/items/{id}";
    public static final String ORDERS_CREATED = "orders.created";

    private Routes() { }
}
