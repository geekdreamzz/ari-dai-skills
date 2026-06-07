---
name: preflight
description: Pre-flight checklist for task completion. Covers app verification, schema validation, feature development flow, and architecture references. Run before marking any task complete.
disable-model-invocation: true
---

# Pre-Flight Checklist

Run through this before marking ANY task complete.

## App Verification (after ANY code changes)

1. **Schema Validation** (if schema.prisma modified):
   ```bash
   docker exec dataspheres-ai-app-1 npx prisma migrate diff \
     --from-migrations ./prisma/migrations \
     --to-schema-datamodel ./prisma/schema.prisma --script
   # Must return: "-- This is an empty migration."
   ```

2. **Schema Change Full Flow** (REQUIRED after any schema.prisma edit):
   ```bash
   DATABASE_URL="postgresql://user:password@localhost:5432/dai-db" npx prisma migrate dev --name NAME --create-only
   DATABASE_URL="postgresql://user:password@localhost:5432/dai-db" npx prisma migrate deploy
   npx prisma generate
   docker compose exec app npx prisma generate   # MANDATORY — container has stale client otherwise
   docker compose restart app
   npm run schema:drift
   ```

3. **Check Logs:** `docker compose logs --tail 50 app` (no TypeScript errors)
4. **Server Health:** `curl http://localhost:3000` (must return 200)
5. **Production Safety:** If schema changes, verify GitHub Actions gate exists
6. **NEVER** mark tasks complete without confirming app runs error-free

**Why `docker compose exec app npx prisma generate` is mandatory:**
The app runs inside Docker. Host-side `prisma generate` does NOT update the container's Prisma client. Without it, new fields return "Internal server error".

## Feature Development Flow

1. Create requirements doc using [Template](docusaurus/docs/feature-requirements/template.md)
2. Define functional + non-functional requirements
3. Follow phased implementation: Database -> Backend -> API -> Frontend -> Testing
4. Ensure 90%+ unit test coverage for critical business logic
5. Verify all acceptance criteria before completion

## Architecture References

- [Code Design Principles](docusaurus/docs/development/code-design-principles.md)
- [Backend Services](docusaurus/docs/codebase/backend-services.md)
- [Frontend Components](docusaurus/docs/codebase/frontend-components.md)
- [Project Structure](docusaurus/docs/codebase/project-structure.md)
- [Pre-Flight Checklist Detail](docusaurus/docs/development/preflight-checklist.md)

## MVC Architecture Enforcement

For every feature, identify:
- **Model**: `src/server/models/` — business logic, validation, data structures
- **View**: `src/client/components/` — React components, UI patterns
- **Controller**: `src/server/endpoints/` — API routes, event orchestration

## Quick Ecosystem Checks

- New feature? -> Create requirements document first + MVC analysis
- Database changes? -> Run /schema-drift
- New imports? -> Verify tsconfig paths
- API changes? -> Backend first (Controller -> Model -> View)
- UI changes? -> Standard layouts + component patterns
- Auth changes? -> Consistent permission logic
- File modifications? -> Update headers with maintenance notes
- Ready to deploy? -> User runs git/docker commands
