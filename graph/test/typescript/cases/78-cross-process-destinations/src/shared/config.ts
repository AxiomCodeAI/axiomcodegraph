// A configured base address: the client reads it off a config object, never as a literal
// at the send. The scheme and host are dropped when the two ends are compared.
export const config = {
  reportsUrl: 'http://reports:8080/api/reports',
  timeoutMs: 3000,
};
