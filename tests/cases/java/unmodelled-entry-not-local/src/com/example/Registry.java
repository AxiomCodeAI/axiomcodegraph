package com.example;

import com.acme.bus.Registered;

@Registered
public class Registry {
    public void refresh() {
        System.out.println("refresh");
    }

    private void tidy() {
        System.out.println("tidy");
    }
}
