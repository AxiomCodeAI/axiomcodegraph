package fn;

/** Takes a one-parameter function, so a method reference reaches it in ARGUMENT position. */
public interface Sink {
    void accept(Fn<Object, String> f);
    void acceptSup(Sup<String> s);
}
