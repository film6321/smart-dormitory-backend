# Prisma Workflow

This folder owns the backend database schema, migrations, and seed workflow.

## Common commands

```powershell
npm run prisma:validate
npm run prisma:generate
npm run db:migrate:deploy
npm run db:seed
```

For local development only, use reset when you intentionally want to rebuild the database from migrations:

```powershell
npm run db:reset
```

## Seed admin

The seed script creates or updates the first admin user from environment variables:

- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_PASSWORD`
- `SEED_ADMIN_FIRST_NAME`
- `SEED_ADMIN_LAST_NAME`

The script is idempotent: rerunning it will not create duplicate admin users for the same email.

## Migration rules

- Add a new migration for schema changes.
- Do not edit old migrations after they have been applied/shared.
- Keep Prisma models aligned with backend modules.
- Controllers must not access Prisma directly; route database work through services.
