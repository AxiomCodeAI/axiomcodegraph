package dep;

/** One hop below Sink, and it declares its OWN one-argument write of a different type. */
public class BufferedSink extends Sink {
    public void write(int b) { }             // same name, same arity, INCOMPATIBLE type
}
