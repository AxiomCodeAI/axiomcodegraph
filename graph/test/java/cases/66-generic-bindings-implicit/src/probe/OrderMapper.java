package probe;

public interface OrderMapper {
    int findOpen();

    int findClosed();

    int findLate();

    int findThis();

    int findDeep();
}
