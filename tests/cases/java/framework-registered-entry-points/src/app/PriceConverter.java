package app;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter
public class PriceConverter implements AttributeConverter<Long, String> {
    public String convertToDatabaseColumn(Long p) { return "" + p; }
    public Long convertToEntityAttribute(String v) { return Long.valueOf(v); }
}
