package probe;

import java.lang.annotation.ElementType;
import java.lang.annotation.Target;

/** A TYPE_USE annotation, so it can sit between the segments of a qualified type. */
@Target(ElementType.TYPE_USE)
@interface Nullable {}
