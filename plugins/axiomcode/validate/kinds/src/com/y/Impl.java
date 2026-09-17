package com.y;

public class Impl extends Base {
    @Override public String must() { return "impl"; }   // deleting this BREAKS the build
    @Override public String may()  { return "impl"; }   // deleting this COMPILES, behaviour changes
}
