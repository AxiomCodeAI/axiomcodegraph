package pkg;

class Writer {
    private final Store store;

    Writer(Store store) {
        this.store = store;
    }

    void write(Event e) {
        store.append(e);
    }

    static String priority(Event e) {
        return "normal";
    }
}

class Store { void save(Record r) {} void append(Event e) {} }
class Codec { String encode(Event e) { return ""; } }
class Record { Record(String id, String body) {} }
class Event { String id() { return ""; } }
