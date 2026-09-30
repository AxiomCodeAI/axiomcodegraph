package web;

public class SecurityConfig {
    public void rules(HttpSecurity http) {
        http.authorizeHttpRequests(a -> a.requestMatchers("/login", "/assets/**", "/health").permitAll());
    }

    public void interceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new AuthInterceptor()).addPathPatterns("/**");
    }
}
