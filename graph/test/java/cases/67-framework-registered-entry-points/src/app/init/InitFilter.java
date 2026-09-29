package app.init;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;

public class InitFilter implements Filter {
    public void doFilter(ServletRequest req, ServletResponse resp, FilterChain chain) { }
}
