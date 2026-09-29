declare module 'axios' {
  interface HttpStatic {
    get(url: string, config?: unknown): Promise<unknown>;
    post(url: string, data?: unknown, config?: unknown): Promise<unknown>;
  }
  const axios: HttpStatic;
  export default axios;
}
