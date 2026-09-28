package com.example;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowMapper;

public abstract class Extractor<R, C> implements ResultSetExtractor<List<R>> {
    private final RowMapper<R> rootMapper;
    private final RowMapper<C> childMapper;
    protected Extractor(RowMapper<R> rootMapper, RowMapper<C> childMapper) { this.rootMapper = rootMapper; this.childMapper = childMapper; }
    public List<R> extractData(ResultSet rs) throws SQLException {
        List<R> out = new ArrayList<>();
        int row = 0;
        while (rs.next()) {
            R root = rootMapper.mapRow(rs, row);
            add(root, childMapper.mapRow(rs, row++));
            out.add(root);
        }
        return out;
    }
    protected abstract void add(R root, C child);
}
