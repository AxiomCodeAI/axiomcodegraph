import { renderSchema } from '../../lib/generate'

export async function codegen(): Promise<void> {
  renderSchema('api')
}
