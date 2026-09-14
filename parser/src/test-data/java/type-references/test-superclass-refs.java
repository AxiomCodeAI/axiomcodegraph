package com.test.typereferences;

import java.util.ArrayList;
import java.util.HashMap;

class Parent { }

class SimpleChild extends Parent { }

class GenericChild extends ArrayList<String> { }

class MultiGenericChild extends HashMap<String, Integer> { }

class DeepGenericChild extends ArrayList<ArrayList<String>> { }

class ParameterizedChild<T> extends ArrayList<T> { }
