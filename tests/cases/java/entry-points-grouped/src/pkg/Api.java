package pkg;

// Four methods a framework invokes and no client call site reaches. The reason is the same for all four,
// so the answer should state it once and name them behind --limit, not repeat the sentence four times.
public class Api {
    public String listOrders() { return "orders"; }

    public String getOrder(String id) { return "order " + id; }

    public String createOrder(String body) { return "created " + body; }

    public String deleteOrder(String id) { return "deleted " + id; }
}
