package pkg;

class Writer {
    private final Store store;
    private final Codec codec;

    Writer(Store store, Codec codec) {
        this.store = store;
        this.codec = codec;
    }

    void write(Event e) {
        store.append(e);
        String body = codec.encode(e);
        store.save(new Record(e.id(), body));
    }

    static String priority(Event e) {
        return "normal";
    }
}

class Store { void save(Record r) {} void append(Event e) {} }
class Codec { String encode(Event e) { return ""; } }
class Record { Record(String id, String body) {} }
class Event { String id() { return ""; } }
