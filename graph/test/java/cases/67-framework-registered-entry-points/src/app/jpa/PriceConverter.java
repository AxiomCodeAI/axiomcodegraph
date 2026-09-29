package app.jpa;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter
public class PriceConverter implements AttributeConverter<Price, Long> {
    public Long convertToDatabaseColumn(Price p) { return p.cents; }
    public Price convertToEntityAttribute(Long v) { return new Price(v); }
}
