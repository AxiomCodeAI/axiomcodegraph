package dep;

/** The first hop: one method returns the element directly, one returns a SECOND
 *  library generic parameterised by the same variable. */
public interface Box<E> {
    E get(int i);
    Iter<E> iterator();
}
