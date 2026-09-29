package app;

public class Money {
    static long cents(long units) { return units * 1000; }
    static long units(long cents) { return cents / 100; }
}
