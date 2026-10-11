package demo.order;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
@Mapper
public interface OrderMapper {
    Order findById(String id);
    List<Order> findOpen();
}
