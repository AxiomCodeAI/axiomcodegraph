import jsonBody from './json-body'

const jsonBodyRequired = <T>(schema: T, description: string) => {
  return {
    ...jsonBody(schema, description),
    required: true,
  }
}

export default jsonBodyRequired
