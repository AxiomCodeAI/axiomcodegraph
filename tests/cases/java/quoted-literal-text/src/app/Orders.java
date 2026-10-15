package app;

public class Orders {
    static final String KEY = "a \"b\" c";
    static final String PLAIN = "a plain value";

    String send(String subject) {
        return subject;
    }

    @Route("/orders/{code}")
    public String notifyLate() {
        return send("Order \"Foo\" Is Late");
    }

    @Route("/say \"hi\"")
    public String greet() {
        return send("The order has shipped");
    }
}
