package com.y;
public class Router {
    String label(Status st) {
        switch (st) {
            case NEW: return "new";
            case DONE: return "done";
            default: return "?";
        }
    }
    boolean isNew(Status st) { return st == Status.NEW; }
}
