package dep;

/** A library-declared callback interface: the SAM shape a client implements and the engine must
 *  fan to, because the library declaration itself has no body. */
@FunctionalInterface
public interface Handler {
    void handle(Event e);
    default String describe() { return "handler"; }
}
