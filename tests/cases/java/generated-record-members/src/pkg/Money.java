package pkg;

/** A record generates its accessors and its canonical constructor. Neither has a declaration to point at. */
public record Money(long amount, String currency) {
}
