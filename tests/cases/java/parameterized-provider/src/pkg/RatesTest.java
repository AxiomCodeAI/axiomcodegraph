package pkg;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import java.util.stream.Stream;

public class RatesTest {
    // named by a STRING in the annotation, never called from anywhere in the program
    static Stream<Integer> cases() { return Stream.of(Rates.base()); }

    @ParameterizedTest
    @MethodSource("cases")
    void everyCase(int v) { assert v > 0; }
}
