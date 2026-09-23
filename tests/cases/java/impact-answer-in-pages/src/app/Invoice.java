package app;

public class Invoice {
	private final Rates rates = new Rates();
	public int total(int n) { return rates.rate(n) + 1; }
}
