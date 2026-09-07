package dep;

/** A library generic whose method returns the type variable itself — the second hop. */
public interface Iter<E> {
    E next();
    boolean hasNext();
}
