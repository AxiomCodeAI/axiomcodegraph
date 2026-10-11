package demo.dao;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.SelectProvider;
@Mapper
public interface StockMapper {
    @Select("select qty from stock where id = #{id}")
    int count(Long id);
    @Select("select sum(qty) from stock")
    int total();
    @SelectProvider(type = StockSql.class, method = "byShelf")
    int byShelf(Long shelf);
}
