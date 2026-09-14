package com.example.service;

import java.io.Serializable;

@interface Service { }

interface ServiceFacade extends Serializable {
    void execute();
}

interface AnotherFacade {
    void process();
}

@Service
class ServiceImpl implements ServiceFacade {
    public void execute() { }
}

@Service
class AnotherService implements AnotherFacade {
    public void process() { }
}

@Service
class GenericService<T extends Serializable> implements ServiceFacade {
    public void execute() { }
}

class HelperClass { }

interface HelperInterface { }
