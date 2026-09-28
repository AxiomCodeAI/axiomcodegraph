package com.example;

import com.acme.bus.OnMessage;

public class Inbox {
    @OnMessage("orders")
    public void receive(String body) {
        System.out.println(body);
    }

    @Deprecated
    public void legacy() {
        System.out.println("old");
    }

    public void plain() {
        System.out.println("plain");
    }
}
