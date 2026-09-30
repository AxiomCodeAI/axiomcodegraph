package demo.user;
import org.apache.ibatis.annotations.Mapper;
@Mapper
public interface UserMapper {
    User findById(String id);
}
