package pkg;

import java.util.List;
import java.util.Map;

public class A {
    int x;

    void f(List<String> xs) {
        x = xs.size();
    }

    int y;
}

interface B {
    int LIMIT = 3;
    void m();
}
