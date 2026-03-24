# CLAUDE.md — Invoicing System

This file provides guidance for AI assistants (Claude and others) working on this codebase. Update it as the project evolves.

---

## Project Overview

This is an **invoicing system** — a web application for creating, managing, and tracking invoices, clients, and payments. This document will be updated as the technology stack and architecture are established.

> **Note:** This repository was initialized on 2026-03-24. The codebase is being set up. Update each section below as decisions are made and code is added.

---

## Repository Structure

```
invoicing-system/
├── CLAUDE.md              # This file
├── README.md              # User-facing documentation
├── .env.example           # Environment variable template
├── .gitignore
│
├── src/                   # Application source code
│   ├── models/            # Data models / database schemas
│   ├── routes/            # API route handlers
│   ├── services/          # Business logic
│   ├── controllers/       # Request/response handling
│   ├── middleware/        # Auth, validation, error handling
│   └── utils/             # Shared utilities/helpers
│
├── tests/                 # Test files (mirror src/ structure)
│   ├── unit/
│   └── integration/
│
├── migrations/            # Database migration files
└── docs/                  # Additional documentation
```

> Update this section once the actual directory structure is established.

---

## Technology Stack

> **To be determined.** Update this section once the stack is chosen. Common choices for an invoicing system:

| Layer         | Option A (Node.js) | Option B (Python)   |
|---------------|--------------------|---------------------|
| Runtime       | Node.js / Bun      | Python 3.11+        |
| Framework     | Express / Fastify  | FastAPI / Django    |
| Database      | PostgreSQL         | PostgreSQL          |
| ORM           | Prisma / Drizzle   | SQLAlchemy / Django ORM |
| Auth          | JWT / Passport     | JWT / Django Auth   |
| Testing       | Jest / Vitest      | Pytest              |
| Package mgr   | npm / pnpm / bun   | pip / uv / poetry   |

---

## Development Setup

> Update with real commands once the stack is established.

```bash
# Clone and install dependencies
git clone <repo-url>
cd invoicing-system
<install command>        # e.g. npm install / pip install -r requirements.txt

# Set up environment
cp .env.example .env
# Edit .env with your local values

# Set up database
<db setup command>       # e.g. npx prisma migrate dev / python manage.py migrate

# Start development server
<start command>          # e.g. npm run dev / python manage.py runserver
```

---

## Environment Variables

Document all required environment variables here. Keep `.env.example` up to date.

| Variable              | Required | Description                          |
|-----------------------|----------|--------------------------------------|
| `DATABASE_URL`        | Yes      | PostgreSQL connection string          |
| `JWT_SECRET`          | Yes      | Secret for signing JWT tokens         |
| `PORT`                | No       | Server port (default: 3000 or 8000)   |
| `NODE_ENV` / `ENV`    | No       | `development`, `test`, or `production`|
| `SMTP_HOST`           | No       | Email server for invoice delivery     |
| `SMTP_PORT`           | No       | Email server port                     |
| `SMTP_USER`           | No       | Email credentials                     |
| `SMTP_PASS`           | No       | Email credentials                     |
| `STRIPE_SECRET_KEY`   | No       | Payment processing (if using Stripe)  |

---

## Core Domain Concepts

These are the key entities in an invoicing system. Align code naming with these terms.

- **Client** — A customer/company to whom invoices are issued.
- **Invoice** — A billing document sent to a client with line items and a total.
- **LineItem** — A single charge on an invoice (description, quantity, unit price).
- **Payment** — A recorded payment against an invoice (partial or full).
- **InvoiceStatus** — Lifecycle state: `draft` → `sent` → `paid` | `overdue` | `cancelled`.
- **User** — A person with access to the system (may support multi-tenancy).
- **Organization** — A billing entity (for multi-tenant setups).

---

## Key Business Rules

1. An invoice total = sum of `(lineItem.quantity × lineItem.unitPrice)` across all line items.
2. Tax may be applied at the invoice level or per line item — be consistent with whichever is chosen.
3. An invoice moves to `overdue` status when `dueDate < today` and status is still `sent`.
4. Payments reduce the invoice's outstanding balance; when balance reaches 0 the status becomes `paid`.
5. `draft` invoices cannot be paid — they must be `sent` first.
6. Deleting an invoice should be a soft delete (set `deletedAt`) to preserve audit history.

---

## API Conventions

> Update with actual routes once implemented.

Follow RESTful conventions:

```
GET    /api/invoices              # List invoices (with filtering/pagination)
POST   /api/invoices              # Create invoice
GET    /api/invoices/:id          # Get single invoice
PUT    /api/invoices/:id          # Replace invoice
PATCH  /api/invoices/:id          # Partial update
DELETE /api/invoices/:id          # Soft delete

POST   /api/invoices/:id/send     # Send invoice to client
POST   /api/invoices/:id/payments # Record a payment

GET    /api/clients
POST   /api/clients
GET    /api/clients/:id
PATCH  /api/clients/:id
DELETE /api/clients/:id
```

**Response format:**
```json
{
  "data": { ... },
  "error": null
}
```
Error responses use appropriate HTTP status codes (400, 401, 403, 404, 422, 500).

---

## Database Conventions

- Table names: **snake_case plural** (`invoices`, `line_items`, `clients`)
- Column names: **snake_case** (`created_at`, `due_date`, `unit_price`)
- Primary keys: `id` (UUID preferred over auto-increment for portability)
- All tables should have: `id`, `created_at`, `updated_at`
- Soft deletes use `deleted_at TIMESTAMP NULL`
- Money values: store as **integer cents** (e.g., $12.50 → `1250`) to avoid floating-point errors
- Currency: store ISO 4217 code (e.g., `"USD"`, `"EUR"`) alongside monetary amounts

---

## Code Conventions

### Naming
- Files/directories: `kebab-case` (e.g., `invoice-service.ts`, `line-items/`)
- Classes: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Database columns/env vars: `UPPER_SNAKE_CASE` and `snake_case` respectively

### Structure
- Keep route handlers thin — delegate business logic to service classes.
- Services should not depend on HTTP request/response objects.
- Use dependency injection for testability (pass DB clients/services in rather than importing globals).
- Validate all user input at the API boundary before it reaches service/DB layer.

### Error Handling
- Never swallow errors silently.
- Throw typed/custom error classes (e.g., `NotFoundError`, `ValidationError`) from services.
- Middleware catches and formats these into consistent HTTP responses.

---

## Testing

> Update with real commands once the test framework is set up.

```bash
# Run all tests
<test command>           # e.g. npm test / pytest

# Run with coverage
<coverage command>       # e.g. npm run test:coverage / pytest --cov

# Run specific file
<specific test>          # e.g. npx jest invoice.test.ts / pytest tests/test_invoice.py
```

### Testing Guidelines
- Unit tests for all service-layer business logic.
- Integration tests for API routes (use a test database or in-memory DB).
- Test file location: mirror `src/` in `tests/` (e.g., `src/services/invoice-service.ts` → `tests/unit/services/invoice-service.test.ts`).
- Seed test data with factory functions, not hard-coded fixtures.
- Each test should be isolated — reset DB state between tests.

---

## Git Workflow

- **Main branch:** `main` — protected, deployable at all times.
- **Feature branches:** `feature/<short-description>` (e.g., `feature/add-payment-api`)
- **Bug fix branches:** `fix/<short-description>`
- **AI-generated branches:** `claude/<description>-<id>`

### Commit Message Format
```
<type>: <short summary>

<optional body>
```
Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `style`

Examples:
```
feat: add POST /api/invoices endpoint
fix: correct overdue status calculation for invoices in UTC
test: add unit tests for payment balance reduction
```

---

## Common Tasks for AI Assistants

### Adding a new API endpoint
1. Define the route in `src/routes/`.
2. Create or update the service in `src/services/`.
3. Add input validation (Zod schema, Pydantic model, etc.).
4. Write unit tests for the service logic.
5. Write an integration test for the route.
6. Update API documentation in this file or `docs/api.md`.

### Adding a database migration
1. Create a new migration file in `migrations/` using the project's migration tool.
2. Do NOT edit existing migration files — always add new ones.
3. Update affected models/types to reflect the schema change.
4. Add/update seed data if necessary.

### Debugging invoice total discrepancies
- Check that all monetary values are stored as integer cents.
- Verify tax is not being applied twice (once per line item and once at the invoice level).
- Confirm deleted line items are excluded from total calculations.

---

## Security Considerations

- Never log sensitive data (passwords, API keys, full card numbers, PII).
- Validate and sanitize all user-provided input before use in DB queries (use parameterized queries / ORM).
- Enforce authorization checks: users should only access their own organization's data.
- Rate-limit authentication endpoints.
- Rotate JWT secrets via environment variables; do not hard-code them.
- Store secrets in environment variables, never in source code.

---

## Deployment

> Update with actual deployment details once established.

- Containerization: Docker (add `Dockerfile` and `docker-compose.yml`)
- CI/CD: GitHub Actions (add `.github/workflows/`)
- Environment promotion: `development` → `staging` → `production`

---

## Updating This File

Keep this file current as the project evolves:
- When adding a new major feature, document its architecture here.
- When changing environment variables, update the table above.
- When establishing the tech stack, fill in the placeholders.
- When adding new business rules, add them to the "Key Business Rules" section.
