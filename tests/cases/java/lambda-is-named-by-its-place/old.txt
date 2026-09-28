package pkg;

import java.util.List;
import java.util.stream.Collectors;

public class Orders {
    private int limit = 3;

    public List<Integer> totals(List<Integer> xs) {
        return xs.stream()
            .filter(x -> x > 0)
            .map(y -> y * 2)
            .collect(Collectors.toList());
    }

    public int names() {
        return limit;
    }
}
