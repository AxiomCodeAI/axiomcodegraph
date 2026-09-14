package dep;

/** A library generic whose method returns another library generic parameterised by a type
 *  that is ITSELF parameterised by this one's variables — the java.util.Map#entrySet shape
 *  (`Set<Entry<K,V>>`). The K and V of the inner type are written on the LIBRARY's own
 *  reference, at depth 2, as type variables rather than as concrete types. */
public interface Lookup<K, V> {
    Box<Pair<K, V>> entries();
    V get(K key);
}
