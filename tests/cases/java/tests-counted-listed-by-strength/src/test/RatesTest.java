package test;

import app.Rates;
import org.junit.jupiter.api.Test;

class RatesTest {
	@Test
	void doublesTheRate() { new Rates().rate(2); }
}
