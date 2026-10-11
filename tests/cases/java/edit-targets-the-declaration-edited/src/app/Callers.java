package app;

public class Callers {
    public int plain(Job j) {
        return j.run();
    }

    public int counted(Job j) {
        return j.run(3);
    }

    public int other(Task t) {
        return t.run() + t.unique();
    }
}
