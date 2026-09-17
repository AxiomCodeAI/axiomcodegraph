package com.y;

/** A base with one ABSTRACT method and one CONCRETE one: deleting an override of each has opposite outcomes. */
public abstract class Base {
    public abstract String must();          // an override of this cannot be deleted: the type stops implementing it
    public String may() { return "base"; }  // an override of this can be deleted: this body runs instead
}
