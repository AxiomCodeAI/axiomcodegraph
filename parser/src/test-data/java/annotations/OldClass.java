package com.test.annotations;

@Deprecated
public class OldClass { }

@interface Deprecated { }

@interface Nullable { }

@interface Override { }

@Nullable
class NullableClass { }

@Override
class OverrideClass { }

@Deprecated
@Nullable
class MultipleMarkers { }
