package pkg;

import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

class MoneyTest {
    // named by the @MethodSource below: JUnit calls it for that test only
    static Stream<Long> bounds() { return Stream.of(Money.cents(1), Money.cents(2)); }

    @ParameterizedTest
    @MethodSource("bounds")
    void positive(long v) { }

    @Test
    void roundTrip() { Money.units(Money.cents(3)); }

    @Test
    void plain() { }
}
