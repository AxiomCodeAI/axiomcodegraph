package com.y;
import java.io.IOException;
public class Caller {
    void a(Svc s) throws IOException { s.save("x"); }
    void b(Svc s) { try { s.save("y"); } catch (IOException e) { } }
    void c(Svc s) { s.plain(); }
}
