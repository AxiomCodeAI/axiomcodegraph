package dep;

// A STAGED library functional interface: the base of a `value` pair is a library method row.
public interface Fn<T, R> {
    R call(T t);
    default Fn<T, R> logged() { return t -> call(t); }
}
