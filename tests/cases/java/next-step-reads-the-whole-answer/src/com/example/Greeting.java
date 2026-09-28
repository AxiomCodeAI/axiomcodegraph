package com.example;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
@Component public class Greeting { @Value("${greet.prefix}") private String prefix; public String hi() { return prefix; } }
