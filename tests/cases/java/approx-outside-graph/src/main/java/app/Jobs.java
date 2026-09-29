package app;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.ResultSet;

public class Jobs {
    private static final String SEED = "db/seed.sql";

    public void rebuild() throws Exception {
        new ProcessBuilder("bash", "scripts/rebuild.sh", "--all").start();
    }

    public void nightly() throws Exception {
        rebuild();
    }

    public String loadSeed() throws Exception {
        return Files.readString(Paths.get(SEED));
    }

    public int countLines(Connection c) throws Exception {
        ResultSet r = c.createStatement().executeQuery("SELECT count(*) FROM order_lines WHERE shipped = 1");
        return r.getInt(1);
    }

    public void report(Connection c) throws Exception {
        System.out.println("shipped today: " + countLines(c));
    }

    public int checkStock(int n) {
        // a stock count below zero used to print "stock went negative" here
        if (n < 0) throw new IllegalStateException("stock level is negative");
        return n;
    }

    /** Old notes: the nightly job also ran cleanup.sh, it no longer does. */
    public void tidy() {
    }

    public int restock(int n) {
        return checkStock(n);
    }
}
