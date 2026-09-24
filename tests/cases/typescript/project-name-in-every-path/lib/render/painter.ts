// The real renderer: it draws the shapes of a scene.
export function drawShapes(shapes: string[]): string {
  return shapes.map(shape => `<${shape}>`).join('')
}
