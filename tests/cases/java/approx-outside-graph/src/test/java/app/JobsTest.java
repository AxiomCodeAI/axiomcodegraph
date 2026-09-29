package app;

public class JobsTest {
    public void purgeIsNotRun() {
        String script = "purge.sh";
        new Jobs().restock(1);
    }

    public void message() {
        String m = "stock went negative";
    }
}
