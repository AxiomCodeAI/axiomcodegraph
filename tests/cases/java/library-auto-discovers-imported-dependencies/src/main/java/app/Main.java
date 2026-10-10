package app;

import com.example.greeter.Greeter;

public class Main {
    public static String welcome(String name) {
        return new Greeter().hello(name).shout();
    }
}
