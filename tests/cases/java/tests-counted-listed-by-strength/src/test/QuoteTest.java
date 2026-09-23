package test;

import app.Quote;
import org.junit.jupiter.api.Test;

class QuoteTest {
	@Test
	void totalAddsOne() { new Quote().total(1); }
	@Test
	void totalOfZero() { new Quote().total(0); }
	@Test
	void totalOfMany() { new Quote().total(9); }
}
