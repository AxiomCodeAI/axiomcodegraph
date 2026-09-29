package demo.order;
public interface BaseMapper<T> {
    T selectOne(String id);
}
