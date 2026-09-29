package probe;

import lombok.Value;
import lombok.With;

/** #1407: @With declares withX(v) returning the owner. */
@Value
@With
public class Temp {
    double degrees;

    public double kelvin() {
        return degrees + 273.15;
    }
}
