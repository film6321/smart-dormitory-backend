export const validateSimpleObject = (schema: Record<string, (value: unknown) => boolean>, input: unknown) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return [{ property: 'body', constraints: { isObject: 'Body must be an object' } }];
  }

  const entries = Object.entries(schema);
  const errors: Array<{ property: string; constraints: Record<string, string> }> = [];

  for (const [property, validator] of entries) {
    const value = (input as Record<string, unknown>)[property];
    if (!validator(value)) {
      errors.push({ property, constraints: { isValid: `${property} is invalid` } });
    }
  }

  return errors;
};
