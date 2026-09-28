package probe.convert;

import org.mapstruct.Mapper;

/** CONTROL: MapStruct's @Mapper, not MyBatis's. Not a proxy bean. */
@Mapper
public interface ItemConverter {
    String convert(Long id);
}
