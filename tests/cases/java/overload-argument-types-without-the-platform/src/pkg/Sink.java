package pkg;

import java.io.Reader;
import java.lang.reflect.Type;

public class Sink {
    void log(String s) { }
    void log(Node n) { }
    void log(int i) { }
    void read(Class<?> c) { }
    void read(Node n) { }
    void read(String s) { }
    void load(String s) { }
    void load(Reader r) { }
    void wrap(String s) { }
    void wrap(Throwable t) { }
    void kind(Type t) { }
    void kind(Class<?> c) { }
    void add(char c) { }
    void add(String s) { }
    void add(Node n) { }
    void take(String s) { }
    void take(Node n) { }
}
