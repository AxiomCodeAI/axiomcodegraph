package com.example;

import org.springframework.stereotype.Component;

@Component
public class Store {
    private final Wire wire;

    public Store(Wire wire) {
        this.wire = wire;
    }

    public String find(String id) {
        return id;
    }
}
