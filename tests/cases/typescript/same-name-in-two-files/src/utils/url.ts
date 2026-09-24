export const mergePath: (...paths: string[]) => string = (...paths) => {
  return paths.join('/').replace(/\/+/g, '/')
}
