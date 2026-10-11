package demo.part;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
@Mapper
public interface PartMapper {
    int reserve(@Param("part") Part part);
}
