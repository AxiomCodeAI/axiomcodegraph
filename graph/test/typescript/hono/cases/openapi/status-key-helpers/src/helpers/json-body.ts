const jsonBody = <T>(schema: T, description: string) => {
  return {
    content: {
      'application/json': {
        schema,
      },
    },
    description,
  }
}

export default jsonBody
