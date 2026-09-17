package com.y;
import java.io.IOException;
public class Svc {
    @Transactional
    public void save(String s) throws IOException { store(s); }
    public void plain() { }
    void store(String s) throws IOException { }
}
