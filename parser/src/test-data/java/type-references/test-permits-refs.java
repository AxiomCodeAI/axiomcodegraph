package com.test.typereferences;

sealed interface Shape permits Circle, Rectangle, Triangle { }

final class Circle implements Shape { }

final class Rectangle implements Shape { }

final class Triangle implements Shape { }

sealed class Vehicle permits Car, Truck { }

final class Car extends Vehicle { }

final class Truck extends Vehicle { }
