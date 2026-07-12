# 06. API Design

## Example Endpoints

### Authentication

- POST /api/auth/login
  - Description: Login user

### Residents

- POST /api/residents
  - Description: Create resident

### Face Recognition

- POST /api/face/register
  - Description: Register face template
- POST /api/face/verify
  - Description: Verify face template

## API Design Guidelines

- Use RESTful endpoints.
- Return JSON responses in a consistent format.
- Use proper HTTP status codes.
- Validate request payloads before processing.
