package probe.config;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.context.annotation.Configuration;

@Configuration
@MapperScan(basePackages = {"probe.**.dao"})
public class ShopMapperConfig { }
