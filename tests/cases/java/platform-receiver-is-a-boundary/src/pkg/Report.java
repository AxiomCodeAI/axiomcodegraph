package pkg;

public class Report {
    private final String title;

    public Report(String title) { this.title = title; }

    @Override
    public String toString() { return "Report " + title; }

    // a client static method that shares its name with a platform one
    public static int max(int a, int b) { return a >= b ? a : b; }
}
