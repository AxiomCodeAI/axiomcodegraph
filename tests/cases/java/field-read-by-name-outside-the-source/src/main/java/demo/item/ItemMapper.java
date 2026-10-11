package demo.item;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
@Mapper
public interface ItemMapper {
    int reserve(@Param("it") Item item);
    int insertAll(@Param("list") List<Item> items);
}
