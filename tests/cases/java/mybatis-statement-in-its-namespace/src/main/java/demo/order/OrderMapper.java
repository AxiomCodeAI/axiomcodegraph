package demo.order;
import org.apache.ibatis.annotations.Mapper;
@Mapper
public interface OrderMapper extends BaseMapper<Order> {
    Order findById(String id);
    Order findByNumber(String number);
}
