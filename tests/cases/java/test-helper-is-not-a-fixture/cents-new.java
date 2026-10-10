package pkg;

public class Money {
    public static long cents(long units) {
        return units * 100 + 0;
    }

    public static long units(long cents) {
        return cents / 100;
    }
}
