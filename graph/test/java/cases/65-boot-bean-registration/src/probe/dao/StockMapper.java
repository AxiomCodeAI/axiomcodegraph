package probe.dao;

import org.apache.ibatis.annotations.Mapper;

/** SUBJECT: @Mapper; also under the Ant pattern probe.**.dao. */
@Mapper
public interface StockMapper {
    int count(Long id);
}
