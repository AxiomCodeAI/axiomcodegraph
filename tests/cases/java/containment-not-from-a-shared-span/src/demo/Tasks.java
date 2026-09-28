package demo;

/** Controls: a callable written inside another one's body is defined by it, on one line or several. */
public class Tasks {
    static void work() { }

    static void audit() { }

    Runnable later() {
        return new Runnable() {
            public void run() { work(); }
        };
    }

    Runnable inline() { return new Runnable() { public void run() { audit(); } }; }

    void schedule() { later(); inline(); }
}
