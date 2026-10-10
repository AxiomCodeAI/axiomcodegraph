package app;

import com.example.greeter.Greeter;
import com.example.nosources.Counter;

public class Main {
    public static String welcome(String name) {
        return new Greeter().hello(name).shout();
    }

    public static int advance() {
        return new Counter().next().size();
    }
}
