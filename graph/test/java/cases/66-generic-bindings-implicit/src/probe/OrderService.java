package probe;

/** #1412: members inherited from Base<OrderMapper>, reached with no written receiver. */
public class OrderService extends Base<OrderMapper> {
    private Holder<OrderMapper> holder;

    public int open() {
        return mapper.findOpen();
    }

    public int closed() {
        return getMapper().findClosed();
    }

    public int viaThis() {
        return this.mapper.findThis();
    }

    /** CONTROL: the argument written on a declared reference. */
    public int late() {
        return holder.get().findLate();
    }
}
