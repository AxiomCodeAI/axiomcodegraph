package dep;

/** A library generic used as a TYPE ARGUMENT of another library generic, so its own
 *  parameters sit at depth 2 of the outer reference. */
public interface Pair<K, V> {
    K key();
    V value();
}
