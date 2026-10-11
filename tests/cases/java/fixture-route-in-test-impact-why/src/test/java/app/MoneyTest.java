package app;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

class MoneyTest {
    static Stream<Long> bounds() { return Stream.of(Money.cents(1), Money.cents(2)); }
    @ParameterizedTest
    @MethodSource("bounds")
    void positive(long v) { }
    @Test
    void roundTrip() { Money.units(Money.cents(3)); }
}
