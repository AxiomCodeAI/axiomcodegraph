package app.web;

import jakarta.servlet.annotation.WebListener;
import jakarta.servlet.http.HttpSessionEvent;
import jakarta.servlet.http.HttpSessionListener;

@WebListener
public class SessionCounter implements HttpSessionListener {
    @Override
    public void sessionCreated(HttpSessionEvent e) { }
}
