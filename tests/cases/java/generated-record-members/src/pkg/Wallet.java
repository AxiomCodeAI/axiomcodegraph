package pkg;

public class Wallet {

    public long doubled(Money m) {
        return m.amount() * 2;          // the generated accessor — no declaration behind it
    }

    public Money make() {
        return new Money(1L, "USD");    // the generated canonical constructor
    }
}
