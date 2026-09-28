package demo;

/** Two definers on one line: each anonymous class belongs to the method whose `new` spans it, and an anonymous class inside another's method belongs to that method. */
public class Pair {
    Runnable first() { return new Runnable() { public void run() { Tasks.work(); } }; } Runnable second() { return new Runnable() { public void run() { Tasks.audit(); } }; }

    Runnable deep() { return new Runnable() { public void run() { new java.util.concurrent.Callable<String>() { public String call() { Tasks.work(); return ""; } }; } }; }
}
