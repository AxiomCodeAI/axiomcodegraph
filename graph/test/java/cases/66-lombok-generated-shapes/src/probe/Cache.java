package probe;

import lombok.experimental.Delegate;

/** #1407: @Delegate declares a forwarder per method of the field's type. */
public class Cache {
    @Delegate
    private final Store inner = new MemStore();

    /** Hand-written: wins over the forwarder of the same signature. */
    public void put(String key) {
    }
}
