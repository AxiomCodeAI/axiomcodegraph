package com.example;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
@Component public class Audit { @EventListener public void on(OrderPlaced e) { System.out.println(e.id); } }
