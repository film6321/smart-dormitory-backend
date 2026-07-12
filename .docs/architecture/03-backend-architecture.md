# 03. Backend Architecture

## Request Flow

Router
↓
Middleware
↓
Controller
↓
Service
↓
Repository
↓
Prisma
↓
Database

## Component Responsibilities

### Router

Defines endpoints and route mapping.

### Middleware

Handles authentication, authorization, logging, validation, rate limiting, and error handling.

### Controller

Receives HTTP requests and returns responses. It should not contain business logic.

### Service

Contains business logic. It may call repositories and external APIs.

### Repository

Encapsulates database access logic.

### Prisma

ORM layer used to query and mutate the database.

### Database

Stores all persistent application data.
