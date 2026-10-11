package probe;

/** NEAR MISS: a generic subclass passes its own variable on; nothing binds M here. */
public class RawService<X> extends Base<X> {
    public Object raw() {
        return getMapper();
    }
}
