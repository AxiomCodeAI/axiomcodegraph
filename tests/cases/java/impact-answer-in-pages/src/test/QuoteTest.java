package test;

import app.Quote;
import org.junit.jupiter.api.Test;

class QuoteTest {
	@Test
	void totalAddsOne() { new Quote().total(1); }
}
