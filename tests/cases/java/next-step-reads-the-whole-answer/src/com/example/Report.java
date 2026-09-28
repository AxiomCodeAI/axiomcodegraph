package com.example;

import org.springframework.jdbc.core.JdbcTemplate;

public class Report {
    private final JdbcTemplate jdbc;
    public Report(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public String build() { return jdbc.query("select name from widgets", new RowExtractor()).toString(); }
}
