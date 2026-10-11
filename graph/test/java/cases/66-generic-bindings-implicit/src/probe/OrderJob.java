package probe;

/** #1547: a generic method's own variable, fixed by the class literal argument. */
public class OrderJob {
    public void run() {
        Beans.get(OrderStore.class).save("a");
        Beans.named("store", OrderStore.class).purge("b");
        OrderStore s = Beans.get(OrderStore.class);
        s.touch("c");
    }

    /** NEAR MISS: raw(Class<?>) returns Object whatever the literal; only the cast types keep(). */
    public void raw() {
        ((OrderStore) Beans.raw(OrderStore.class)).keep("d");
        Beans.raw(OrderStore.class).hashCode();
    }
}
