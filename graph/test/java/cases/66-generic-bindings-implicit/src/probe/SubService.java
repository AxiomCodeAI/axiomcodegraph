package probe;

/** #1412: a subclass of the type that fixed M inherits the binding. */
public class SubService extends OrderService {
    public int deep() {
        return getMapper().findDeep();
    }
}
