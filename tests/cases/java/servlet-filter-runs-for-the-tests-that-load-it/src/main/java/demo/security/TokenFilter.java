package demo.security;

import java.io.IOException;
import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;

public class TokenFilter extends OncePerRequestFilter {
  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String token = tokenOf(request.getHeader("Authorization"));
    request.setAttribute("token", token);
    chain.doFilter(request, response);
  }

  private String tokenOf(String header) {
    if (header == null) {
      return null;
    }
    return header.substring(header.indexOf(' ') + 1);
  }
}
