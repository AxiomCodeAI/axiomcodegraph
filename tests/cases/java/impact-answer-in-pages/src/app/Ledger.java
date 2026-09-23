package app;

public class Ledger {
	private final Rates rates = new Rates();
	public int total(int n) { return rates.rate(n) + 1; }
}
