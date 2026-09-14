package com.test.typereferences;

import java.io.Serializable;
import java.util.List;

class SingleInterface implements Runnable { }

class MultipleInterfaces implements Serializable, Cloneable { }

class GenericInterfaces implements Comparable<String>, Serializable { }

class ComplexGenericInterfaces implements Comparable<List<String>>, Cloneable { }

interface ExtendingInterface extends Serializable, Cloneable { }

interface GenericExtendingInterface extends Comparable<String> { }
