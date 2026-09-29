// The client package, as its types describe it. The rules key on the import's
// specifier, so this stands in for the package without changing what is read.
declare module 'axios' {
  interface HttpInstance {
    get(url: string, config?: unknown): Promise<unknown>;
    post(url: string, data?: unknown, config?: unknown): Promise<unknown>;
  }
  interface HttpStatic extends HttpInstance {
    create(config: { baseURL?: string }): HttpInstance;
  }
  const axios: HttpStatic;
  export default axios;
}
