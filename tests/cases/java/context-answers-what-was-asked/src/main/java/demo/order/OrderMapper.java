package demo.order;

import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface OrderMapper {
    Order findByNumber(String number);
}
