package app.settings;

import org.springframework.stereotype.Service;

@Service
public class Reader {
    private final ThirdParty third;
    private final PlainProperties plain;
    private final Pool pool;
    private final OtherThing other;

    public Reader(ThirdParty third, PlainProperties plain, Pool pool, OtherThing other) {
        this.third = third; this.plain = plain; this.pool = pool; this.other = other;
    }
    public String thirdEndpoint() { return third.getEndpoint(); }
    public String plainEndpoint() { return plain.getEndpoint(); }
    public int poolSize() { return pool.getSize(); }
    public String otherEndpoint() { return other.getEndpoint(); }
}
