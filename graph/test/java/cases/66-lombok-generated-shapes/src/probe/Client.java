package probe;

public class Client {
    public boolean locked(Account a) {
        a.setLocked(true);
        return a.isLocked();
    }

    /** CONTROL and near misses for #1404. */
    public boolean others(Account a) {
        a.setActive(true);
        a.setIsland(false);
        a.setIsOpen(true);
        return a.isActive() && a.isIsland() && a.getIsOpen();
    }

    public void order() {
        Order o = Order.builder().sku("a").qty(2).build();
        o.ship();
        Order.builder().sku("b").build().ship();
        o.toBuilder().qty(3).build();
    }

    /** NEAR MISS: a static field has no builder setter. */
    public void orderStatic() {
        Order.builder().created(1);
    }

    public void ticket() {
        Ticket.make().title("t").build().open();
    }

    public void settings(Settings s) {
        s.setHost("h").setPort(1).apply();
        s.setPort(2);
        s.apply();
    }

    public void node(Node n) {
        n.label("x");
        n.next().visit();
        n.visit();
        n.setWeight(2);
        n.getWeight();
    }

    public double temp(Temp t) {
        return t.withDegrees(3.0).kelvin() + t.kelvin();
    }

    public int point() {
        return Point.of(1, 2).sum();
    }

    public void cache(Cache c) {
        c.put("a");
        c.child("b").put("c");
    }
}
