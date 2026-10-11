package probe;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;

/** #1452: a class named in a FIELD annotation is a type use, as on a type or a method. */
@JsonSerialize(using = TypeSer.class)
public class Widget {
    @JsonSerialize(using = FieldSer.class)
    private long weight;

    @JsonSerialize(using = MethodSer.class)
    public long getPrice() {
        return 0L;
    }
}
