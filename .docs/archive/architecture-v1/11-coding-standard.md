# 11. Coding Standard

## Controller Rules

- No database query in controller.
- Only receive request and return response.

## Service Rules

- Put business logic only in service.
- Services may call repositories and external APIs.

## Repository Rules

- Database access must be encapsulated in repository layer.
- Prisma should be used through repository abstraction.

## Module Rules

- One module should have one responsibility.
- Keep module boundaries clear.

## Response Rules

- Always return JSON responses.
- Use consistent response format across modules.

## Architecture Rules

- Use TypeScript for all source files.
- Keep controllers thin.
- Avoid mixing business logic across layers.
