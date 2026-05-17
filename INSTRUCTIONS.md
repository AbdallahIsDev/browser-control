# MADARCARE IMPLEMENTATION INSTRUCTIONS 1S

You are implementing MadarCare in the existing repository at:

```txt
C:\Users\11\projects\clinic-platform
```

This file is the source-of-truth execution contract for an AI coding agent. Read it completely before editing anything. The required outcome is a complete, premium, production-quality web product: public website and marketplace, clinic dashboard, owner dashboard, strong backend, real database persistence, tests, and real-user verification.

Do not treat this as a demo. Do not stop at scaffolding. Do not ask the user what to do next when a reasonable technical decision can be made from this document, the current codebase, official documentation, or direct inspection.

==================================================
PERSISTENT GOAL MODE
==================================================

Single active goal:

Build MadarCare from the current monorepo into a premium, usable clinic growth operating system with a complete public website/marketplace, complete clinic dashboard, complete owner dashboard, strong NestJS backend, PostgreSQL persistence, Prisma schema, authentication, authorization, tests, and product-level verification.

Rules:

1. Work only inside `C:\Users\11\projects\clinic-platform` unless this file explicitly requires external software installation, local database setup, browser testing, or official documentation lookup.
2. Read this file, `README.md`, `docs/PROJECT_VISION.md`, `docs/RESEARCH_SUMMARY.md`, `package.json`, `pnpm-workspace.yaml`, `turbo.json`, and every relevant app/package file before major edits.
3. Execute the implementation. Do not stop at a plan.
4. Do not ask the user for routine technical decisions. Choose strong defaults and continue.
5. If dependencies are missing, install them with the repo package manager. The repo uses pnpm.
6. If a database is needed, set up PostgreSQL locally. Prefer Docker Compose if Docker is available. Otherwise use an existing local PostgreSQL installation. Do not ask the user to set it up manually unless every automated option is proven unavailable.
7. If documentation is needed, search online and prefer official docs: Next.js, NestJS, Prisma, PostgreSQL, Tailwind, shadcn/ui, Playwright, and any installed library docs.
8. Brainstorm internally before each major implementation step: compare viable approaches, reject weak approaches, choose the simplest robust design, then implement.
9. Follow the existing architecture. Do not invent a parallel framework or unrelated architecture.
10. Use tests and real browser verification. Do not claim completion because code compiles only.
11. If a command fails, diagnose, fix, and rerun it. Do not report the first failure as a blocker unless the blocker is real and evidenced.
12. Do not silently delete user data, migrations, or databases. If recovery is required, quarantine, document, and proceed safely.
13. Clean up servers, browsers, test processes, terminals, and helper processes started during the task unless intentionally left running and reported.
14. Do not claim "complete", "premium", "ready", or "production-quality" while any required gate is missing.
15. If anything remains unverified, mark it Partial or Blocked with evidence.

==================================================
PROJECT CONTEXT
==================================================

MadarCare is a clinic growth operating system. It combines:

1. Premium clinic websites/templates.
2. Public marketplace discovery for patients.
3. Clinic operations dashboard.
4. Doctors/providers management.
5. Services, pricing, and availability.
6. Appointment booking and lifecycle management.
7. Patient operational records generated from bookings.
8. Revenue and performance analytics.
9. Platform owner dashboard for approvals, moderation, subscriptions, and promotion.

Clinics are the paying customers. Patients are public users. The platform owner manages the ecosystem.

The product must support three product surfaces:

```txt
/         public marketplace, landing page, clinic websites
/clinic   clinic/admin dashboard
/owner    platform owner dashboard
```

The current repo is a TypeScript monorepo:

```txt
apps/web       Next.js, React, Tailwind
apps/api       NestJS
packages/db    Prisma, PostgreSQL
packages/shared shared schemas and domain logic
```

Current package names may still say `vetly` or `@vetly/*`. Treat MadarCare as the product brand. A brand cleanup from `vetly` to `madarcare` is required before release unless it creates unsafe churn. If delayed, document it as Partial and explain why.

==================================================
REQUIRED READING ORDER
==================================================

Read these files before implementation:

1. `README.md`
2. `INSTRUCTIONS 1S.MD`
3. `docs/PROJECT_VISION.md`
4. `docs/RESEARCH_SUMMARY.md`
5. `package.json`
6. `pnpm-workspace.yaml`
7. `turbo.json`
8. `packages/db/prisma/schema.prisma`
9. `packages/shared/src/index.ts`
10. `packages/shared/src/booking-status.ts`
11. `packages/shared/src/schemas/auth.ts`
12. `packages/shared/src/schemas/appointment.ts`
13. `apps/api/src/app.module.ts`
14. `apps/api/src/main.ts`
15. `apps/api/src/auth/auth.module.ts`
16. `apps/api/src/auth/auth.service.ts`
17. `apps/api/src/auth/auth.controller.ts`
18. `apps/api/src/appointments/appointments.module.ts`
19. `apps/api/src/appointments/appointments.service.ts`
20. `apps/api/src/appointments/appointments.controller.ts`
21. `apps/api/src/common/guards/tenant.guard.ts`
22. `apps/api/src/common/pipes/zod.pipe.ts`
23. `apps/api/src/common/prisma/prisma.service.ts`
24. `apps/web/app/layout.tsx`
25. `apps/web/app/globals.css`
26. `apps/web/middleware.ts`
27. `apps/web/app/(marketplace)/page.tsx`
28. `apps/web/app/(marketplace)/clinics/[slug]/page.tsx`
29. `apps/web/app/(clinic)/clinic/layout.tsx`
30. `apps/web/app/(clinic)/clinic/appointments/page.tsx`
31. `apps/web/app/(owner)/owner/layout.tsx`
32. `apps/web/app/(owner)/owner/page.tsx`
33. `apps/web/app/login/page.tsx`
34. `apps/web/app/register/page.tsx`
35. Existing tests under `apps/api/test` and `packages/shared/test`

Then inspect the rest of `apps`, `packages`, and `docs` as needed. Exclude `node_modules`, build outputs, `.next`, `dist`, `.turbo`, and generated files unless debugging dependency behavior.

==================================================
PRODUCT REQUIREMENTS
==================================================

Build the complete product, not isolated pages.

The final product must include:

- Public premium landing page.
- Public clinic marketplace.
- Clinic search and filters.
- Public clinic profile pages.
- Booking request flow.
- Patient appointment status view.
- Clinic dashboard with navigation and real data.
- Clinic website/template management.
- Clinic profile management.
- Doctors/providers management.
- Services management.
- Availability management.
- Appointment inbox/calendar/list management.
- Patient operational records.
- Revenue tracking.
- Analytics dashboard.
- Owner dashboard.
- Clinic approval workflow.
- Marketplace status management.
- Promoted listing management.
- Subscription status management, at least manually.
- Auth and role-based access.
- Tenant isolation.
- Audit logging.
- Tests.
- Real browser verification.

==================================================
BRAND AND NAMING
==================================================

Use the product brand:

```txt
MadarCare
```

Brand architecture:

```txt
MadarCare              main product/company
MadarCare Clinic       clinic dashboard and SaaS product
MadarCare Search       public marketplace/search surface
MadarCare Console      platform owner dashboard
```

Frontend copy must feel premium, clinical, trustworthy, and business-focused. Avoid generic demo text such as "Lorem ipsum", "coming soon", "TODO", or placeholder-only pages.

If package names still use `vetly`, decide whether to rename them early:

- `vetly` -> `madarcare`
- `@vetly/api` -> `@madarcare/api`
- `@vetly/web` -> `@madarcare/web`
- `@vetly/db` -> `@madarcare/db`
- `@vetly/shared` -> `@madarcare/shared`

If renaming, update all imports, package files, lockfile, workspace references, tests, and docs. Run build and tests after the rename.

==================================================
TECH STACK
==================================================

Use the existing TypeScript stack:

- Monorepo: pnpm workspaces and Turbo.
- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS, shadcn/ui.
- Backend: NestJS, TypeScript.
- Database: PostgreSQL.
- ORM: Prisma.
- Validation: Zod in shared package, reused by API and frontend where practical.
- Testing: Node test runner or existing app test runners; add Playwright for E2E if not present.
- Browser verification: use the available browser automation tooling or Playwright.

Do not replace Next.js, NestJS, Prisma, or PostgreSQL with another stack.

You may add dependencies when justified:

- `@prisma/client`, `prisma` if missing or broken.
- `class-transformer`, `helmet`, `compression`, `cookie`, CORS/session helpers if needed.
- Playwright for E2E.
- shadcn/ui is mandatory for frontend UI primitives and common components.
- Chart library for analytics if needed.

Keep dependencies purposeful. Do not add a second UI framework that fights Tailwind or shadcn/ui.

==================================================
SHADCN/UI REQUIREMENTS
==================================================

Use shadcn/ui for the frontend design system. Do not hard-code generic replacements for components that shadcn/ui already provides.

Required setup:

1. Read the official shadcn/ui Next.js docs when needed: `https://ui.shadcn.com/docs/installation/next`.
2. Run the required preset command for the frontend app. Because this is a monorepo with the web app in `apps/web`, run it from `apps/web` unless the CLI requires a repo-root config path:

```bash
cd apps/web
npx shadcn@latest init --preset b5KJfbwqu --template next
```

3. If the CLI detects monorepo configuration differently, use the official shadcn/ui monorepo guidance and continue without asking the user.
4. Commit to the shadcn/ui component model:
   - Add components through the CLI.
   - Import generated components from the configured UI component path.
   - Do not manually recreate buttons, cards, dialogs, sidebars, inputs, selects, calendars, tables, tabs, badges, alerts, dropdowns, sheets, skeletons, or tooltips when shadcn/ui equivalents exist.
   - Build product-specific components by composing shadcn/ui primitives.
5. Install/add at least the components needed for MadarCare:

```bash
npx shadcn@latest add button card input label textarea select checkbox switch badge table tabs dialog alert-dialog dropdown-menu sheet sidebar skeleton separator tooltip popover calendar command form sonner navigation-menu breadcrumb pagination avatar progress
```

6. Add chart-related components or a chart dependency only when implementing analytics.
7. Keep generated shadcn/ui components maintainable. Do not edit generated primitives unnecessarily; prefer composition in product components.
8. Ensure shadcn theme tokens match MadarCare: premium, clinical, trustworthy, modern, not generic.
9. Verify the preset does not break Tailwind, global CSS, import aliases, or Next.js build.
10. If the preset command modifies existing app files, review the diff and integrate it with current routes instead of overwriting product work blindly.

Frontend implementation rule:

Use shadcn/ui for UI primitives, Tailwind for layout/composition, and product-specific React components for MadarCare workflows.

==================================================
DATABASE REQUIREMENTS
==================================================

Use PostgreSQL through Prisma.

Required models:

- User
- Clinic
- ClinicMember
- Doctor
- Service
- AvailabilityRule
- Patient
- Appointment
- BookingSource
- RevenueEntry
- AuditLog

Required enums:

- UserRole: `PATIENT`, `CLINIC_OWNER`, `CLINIC_STAFF`, `PLATFORM_OWNER`
- MarketplaceStatus: `PRIVATE`, `PENDING_REVIEW`, `LISTED`, `SUSPENDED`, `PROMOTED`
- AppointmentStatus: `PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELLED`, `REJECTED`

Required database behavior:

- Every clinic-owned record must include `clinicId` or be reachable through clinic ownership.
- Queries for clinic users must be scoped by clinic membership.
- Public queries must return only `LISTED` or `PROMOTED` clinics unless explicitly showing a clinic owner's preview.
- Owner queries may access all clinics but must be protected by `PLATFORM_OWNER`.
- Create indexes for common filters: clinic slug, marketplace status, city, clinicId relations, requested appointment time, doctorId, serviceId.
- Use transactions for multi-step writes: registration plus clinic creation, appointment plus patient creation, status update plus audit log, revenue entry plus audit log.
- Do not store clinical/EMR notes in MVP. Operational notes only.

If the current schema is incomplete, extend it with migrations. Do not edit the database manually without a migration unless repairing a local development setup.

==================================================
AUTHENTICATION AND AUTHORIZATION
==================================================

Build real auth. No fake login.

Required:

- Register.
- Login.
- Password hashing with bcrypt or argon2.
- JWT or secure session strategy.
- Role claims.
- Clinic membership lookup.
- Guards for role and tenant access.
- Token expiration.
- Safe auth errors.
- Protected dashboard routes.

Role rules:

- `PATIENT`: public account, own appointment view/cancel only.
- `CLINIC_OWNER`: manage owned clinic and staff, request listing, manage clinic data.
- `CLINIC_STAFF`: manage allowed clinic operations only.
- `PLATFORM_OWNER`: manage all clinics, approvals, promoted status, subscriptions, and platform settings.

Do not rely only on frontend middleware for security. Enforce authorization in the API.

Test:

- Missing token fails.
- Invalid token fails.
- Patient cannot access clinic endpoints.
- Clinic owner cannot access another clinic.
- Clinic owner cannot approve own listing.
- Platform owner can approve listings.

==================================================
BACKEND REQUIREMENTS
==================================================

Build a strong NestJS backend.

Required modules:

- AuthModule
- UsersModule if needed
- ClinicsModule
- DoctorsModule
- ServicesModule
- AvailabilityModule
- AppointmentsModule
- PatientsModule
- RevenueModule
- AnalyticsModule
- OwnerModule or PlatformModule
- AuditModule
- PublicMarketplaceModule

Required API areas:

```txt
POST   /auth/register
POST   /auth/login
GET    /me

GET    /public/clinics
GET    /public/clinics/:slug
GET    /public/clinics/:slug/availability
POST   /public/clinics/:slug/appointments

GET    /clinics/:clinicId
PATCH  /clinics/:clinicId
POST   /clinics/:clinicId/listing-request

GET    /clinics/:clinicId/doctors
POST   /clinics/:clinicId/doctors
PATCH  /clinics/:clinicId/doctors/:doctorId
DELETE /clinics/:clinicId/doctors/:doctorId

GET    /clinics/:clinicId/services
POST   /clinics/:clinicId/services
PATCH  /clinics/:clinicId/services/:serviceId
DELETE /clinics/:clinicId/services/:serviceId

GET    /clinics/:clinicId/availability
PUT    /clinics/:clinicId/availability

GET    /clinics/:clinicId/appointments
POST   /clinics/:clinicId/appointments
PATCH  /clinics/:clinicId/appointments/:appointmentId/status

GET    /clinics/:clinicId/patients
GET    /clinics/:clinicId/revenue
POST   /clinics/:clinicId/revenue
GET    /clinics/:clinicId/analytics

GET    /owner/clinics
GET    /owner/clinics/:clinicId
PATCH  /owner/clinics/:clinicId/status
PATCH  /owner/clinics/:clinicId/subscription
GET    /owner/analytics
```

Backend quality requirements:

- Use DTO validation through Zod or Nest pipes.
- Return consistent error shapes.
- Use pagination for list endpoints.
- Use sorting and filters where relevant.
- Use transactions for multi-step writes.
- Use tenant-safe query helpers where practical.
- Add audit logs for sensitive actions.
- Add request security middleware: CORS configured for the web app, Helmet if added, body size limits, rate limiting for auth and public booking.
- Do not leak password hashes.
- Do not return other clinics' data.
- Keep controllers thin and services responsible for business logic.
- Keep shared domain rules in `packages/shared` when frontend and backend both need them.

==================================================
FRONTEND REQUIREMENTS
==================================================

Build a premium web product, not placeholder pages. The UI foundation must be shadcn/ui initialized with the required preset.

Required frontend surfaces:

1. Public marketing homepage.
2. Public marketplace.
3. Public clinic website/profile pages.
4. Booking flow.
5. Login/register.
6. Clinic dashboard.
7. Owner dashboard.

Frontend quality bar:

- shadcn/ui components are used for standard UI primitives.
- Responsive desktop and mobile layouts.
- Real navigation.
- Real forms.
- Loading states.
- Empty states.
- Error states.
- Success states.
- Accessible labels.
- Clear visual hierarchy.
- No overlapping text.
- No placeholder-only UI.
- No giant decorative landing page that hides the product.
- Dashboards should be dense, organized, practical, and professional.
- Public clinic pages should feel premium, trust-building, and medically appropriate.

Use shadcn/ui plus Tailwind. Use restrained color, strong spacing, and reusable components. Avoid one-note palettes and generic SaaS templates.

Do not hard-code these from scratch when shadcn/ui provides them:

- Button
- Card
- Input
- Label
- Textarea
- Select
- Checkbox
- Switch
- Badge
- Table
- Tabs
- Dialog
- Alert Dialog
- Dropdown Menu
- Sheet
- Sidebar
- Skeleton
- Separator
- Tooltip
- Popover
- Calendar
- Command
- Form
- Toast/Sonner
- Navigation Menu
- Breadcrumb
- Pagination
- Avatar
- Progress

Required public pages:

```txt
/                         landing + search entry
/clinics                  search results
/clinics/[slug]           premium clinic profile/site
/clinics/[slug]/book      booking flow
/me/appointments          patient appointments
/login
/register
```

Required clinic pages:

```txt
/clinic
/clinic/site
/clinic/profile
/clinic/services
/clinic/doctors
/clinic/availability
/clinic/appointments
/clinic/patients
/clinic/revenue
/clinic/analytics
```

Required owner pages:

```txt
/owner
/owner/clinics
/owner/clinics/[id]
/owner/approvals
/owner/settings
```

==================================================
PREMIUM CLINIC TEMPLATES
==================================================

Build at least three ready-made clinic website templates:

1. **Modern Specialty Clinic**
   - General premium medical layout.
   - Hero with clinic trust message, CTA, doctor/service highlights.
   - Works for dermatology, dental, orthopedic, pediatric, and general clinics.

2. **Aesthetic Clinic**
   - Premium visual feel.
   - Strong before/after-safe structure without fake medical claims.
   - Services, doctor credibility, booking CTA, WhatsApp CTA.

3. **Family Care Clinic**
   - Calm, accessible, trust-first layout.
   - Good for family medicine, pediatrics, internal medicine.

Templates must be real components, not static screenshots. Clinic owners should be able to select a template and configure:

- Clinic name.
- Tagline.
- Hero content.
- Services shown.
- Doctors shown.
- Photos or image placeholders.
- Primary color/theme tokens.
- Contact and WhatsApp CTA.
- SEO title/description.

If real image assets are needed, use safe placeholder image sources or generated assets. Do not hotlink unstable or copyrighted images without a clear license.

==================================================
APPOINTMENT AND SCHEDULING REQUIREMENTS
==================================================

Appointment statuses:

```txt
PENDING
CONFIRMED
COMPLETED
CANCELLED
REJECTED
```

Allowed transitions:

```txt
PENDING -> CONFIRMED
PENDING -> REJECTED
PENDING -> CANCELLED
CONFIRMED -> COMPLETED
CONFIRMED -> CANCELLED
```

Rules:

- Final statuses cannot transition again.
- Clinic staff can confirm, reject, complete, or cancel clinic appointments.
- Patients can request appointments and cancel their own pending/confirmed appointments when policy allows.
- Public booking creates or links an operational patient record.
- No double booking for the same doctor/time/service duration.
- Availability uses weekly rules first. Advanced calendar exceptions can come later if time allows.
- Appointment status changes must create audit logs.

==================================================
ANALYTICS AND REVENUE REQUIREMENTS
==================================================

Clinic analytics must include:

- Total appointments.
- Pending appointments.
- Confirmed appointments.
- Completed appointments.
- Cancelled/rejected appointments.
- Revenue by date range.
- Revenue by doctor.
- Revenue by service/procedure.
- Top services.
- Top doctors.
- Booking source breakdown.
- Marketplace vs website vs WhatsApp/phone source where available.

Owner analytics must include:

- Total clinics.
- Listed clinics.
- Pending review clinics.
- Suspended clinics.
- Promoted clinics.
- Total appointments platform-wide.
- Booking volume trend.
- Top clinics by bookings.
- Top cities.

Use real database aggregations where practical. Avoid fake analytics. If seed data is used for local demo, label it as seed data and keep it separate from production logic.

==================================================
DATA SEEDING REQUIREMENTS
==================================================

Create a development seed script if missing.

Seed should include:

- One platform owner.
- One clinic owner.
- One clinic staff user.
- One patient.
- At least three clinics.
- At least one listed clinic and one pending review clinic.
- At least one promoted clinic.
- Doctors for each clinic.
- Services for each clinic.
- Availability rules.
- Appointments in multiple statuses.
- Revenue entries.
- Booking sources.

Seed credentials must be documented for local development only. Do not use production-like secrets.

==================================================
SECURITY REQUIREMENTS
==================================================

Required:

- Passwords hashed.
- JWT/session secret loaded from env.
- No hardcoded production secrets.
- `.env.example` with required variables.
- Role guards.
- Tenant guards.
- API-level authorization checks.
- Rate limiting for login/register/public booking.
- Input validation everywhere.
- Audit logs for sensitive actions.
- No password hash returned in API responses.
- No clinical medical record storage in MVP.
- CORS restricted to allowed frontend origin in production.
- Secure cookies if cookie auth is used.

Adversarial checks:

- Patient token cannot access `/clinic` API data.
- Clinic owner token cannot access another clinic.
- Clinic owner cannot approve their own listing.
- Missing token fails protected endpoints.
- Invalid role fails protected endpoints.
- Public listing endpoint does not expose private clinics.
- Suspended clinics do not appear publicly.

==================================================
IMPLEMENTATION PHASES
==================================================

Follow these phases. Do not skip a phase silently. If a phase is already implemented, verify it and move on.

## Phase 0: Baseline And Tooling

1. Run `pnpm install`.
2. Inspect package scripts.
3. Run current tests/build.
4. Fix broken scripts.
5. Add missing root scripts if useful:
   - `dev`
   - `build`
   - `test`
   - `lint`
   - `typecheck`
   - `db:generate`
   - `db:migrate`
   - `db:seed`
6. Add `.env.example`.
7. Confirm local PostgreSQL setup.
8. Add Docker Compose for PostgreSQL if no clear database setup exists.
9. Generate Prisma client.
10. Run migrations.

## Phase 1: Brand And Architecture Cleanup

1. Normalize product name to MadarCare in docs and UI.
2. Decide whether to rename `vetly` package names.
3. If renaming, update imports and workspace references completely.
4. Keep monorepo architecture.
5. Ensure shared package exports schemas and domain rules cleanly.
6. Ensure API imports shared and db packages through workspace packages, not brittle paths.

## Phase 2: Database And Domain Model

1. Complete Prisma schema.
2. Add indexes and constraints.
3. Add migrations.
4. Add seed script.
5. Add shared Zod schemas for:
   - auth
   - clinic
   - doctor
   - service
   - availability
   - appointment
   - revenue
   - owner status updates
6. Add domain rules for appointment status transitions and marketplace status transitions.
7. Test domain rules.

## Phase 3: Auth And Authorization

1. Complete register/login.
2. Add `GET /me`.
3. Add role guard.
4. Fix tenant guard.
5. Add clinic membership checks.
6. Protect all clinic and owner endpoints.
7. Add tests for auth and role boundaries.

## Phase 4: Clinic Backend

Implement backend modules and tests for:

- Clinic profile.
- Clinic website/template settings.
- Doctors.
- Services.
- Availability.
- Appointments.
- Patients.
- Revenue.
- Analytics.
- Listing request.

Use transactions and audit logs.

## Phase 5: Public Marketplace Backend

Implement:

- Public clinic listing.
- Search/filter by city, service, doctor specialty, promoted/listed status.
- Clinic profile by slug.
- Public availability read.
- Public booking request.
- Patient appointment lookup/cancel with safe ownership.

## Phase 6: Owner Backend

Implement:

- Clinic list.
- Clinic details.
- Approve listing.
- Reject listing if supported.
- Suspend clinic.
- Promote/unpromote clinic.
- Manual subscription status.
- Owner analytics.
- Audit logs.

## Phase 7: Frontend Foundation

1. Initialize shadcn/ui in `apps/web` using:

```bash
cd apps/web
npx shadcn@latest init --preset b5KJfbwqu --template next
```

2. Add required shadcn/ui components through the CLI.
3. Build product-specific composed components from shadcn/ui primitives.
4. Build app shell.
5. Build auth pages.
6. Wire API client.
7. Store auth token/session safely.
8. Add route protection.
9. Add loading, empty, error, and success states.

## Phase 8: Public Website And Marketplace

Build:

- Premium landing page.
- Search experience.
- Clinic cards.
- Clinic profile/template rendering.
- Booking form.
- Appointment status page.
- Responsive mobile version.

## Phase 9: Clinic Dashboard

Build complete dashboard:

- Overview.
- Website/template manager.
- Profile editor.
- Doctors CRUD.
- Services CRUD.
- Availability editor.
- Appointment management.
- Patients list/detail.
- Revenue entry/list.
- Analytics.
- Listing request status.

## Phase 10: Owner Dashboard

Build complete dashboard:

- Overview.
- Clinic list.
- Approval queue.
- Clinic detail page.
- Status controls.
- Promotion controls.
- Subscription controls.
- Platform analytics.

## Phase 11: Testing And E2E

Add/verify:

- Shared domain tests.
- API unit/integration tests.
- Auth boundary tests.
- Tenant isolation tests.
- Appointment workflow tests.
- Marketplace visibility tests.
- Frontend build.
- E2E tests for core user journeys.

Required E2E journeys:

1. Clinic owner registers, gets clinic, edits profile.
2. Clinic owner adds doctor, service, availability.
3. Clinic owner requests listing.
4. Platform owner approves listing.
5. Patient finds clinic publicly.
6. Patient books appointment.
7. Clinic confirms appointment.
8. Patient sees confirmed status.
9. Clinic records revenue.
10. Clinic sees analytics update.

## Phase 12: Premium Polish

1. Review every page visually.
2. Fix spacing, responsive behavior, typography, and interaction states.
3. Add realistic seed data.
4. Add helpful empty states.
5. Add user-facing errors.
6. Add skeleton/loading states where needed.
7. Confirm no placeholder-only pages remain.

==================================================
FRONTEND UI STANDARD
==================================================

Clinic/product dashboards must be utilitarian and premium:

- Use shadcn/ui `Sidebar`, `Table`, `Card`, `Tabs`, `Dropdown Menu`, `Dialog`, `Badge`, `Button`, `Input`, `Select`, `Skeleton`, and related primitives where applicable.
- Left navigation.
- Clear page titles.
- Dense but readable data tables.
- Search/filter controls.
- Strong empty states.
- Forms with validation.
- Confirmation for destructive actions.
- Clear status badges.
- Metrics cards only where useful.
- No decorative clutter.

Public pages must be trust-building:

- Clear brand signal.
- Search as a first-class action.
- Real clinic/service content from seed/API.
- Strong booking CTA.
- Contact and WhatsApp CTA.
- Doctor credibility.
- Services and price/duration where available.
- Location and operating hours.
- Mobile-first booking path.

Do not use visible instructional text explaining how the app works unless it is user-facing product copy.

==================================================
BACKEND QUALITY STANDARD
==================================================

The backend must be:

- Typed.
- Modular.
- Tested.
- Validated.
- Tenant-safe.
- Transactional for multi-step writes.
- Audited for sensitive actions.
- Consistent in error handling.
- Efficient enough for real use.

Performance basics:

- Use pagination.
- Avoid N+1 queries where obvious.
- Add Prisma indexes for common filters.
- Do not fetch unnecessary fields.
- Use aggregates for analytics.
- Keep expensive public queries bounded.

==================================================
TESTING COMMANDS
==================================================

Use commands that match the repo. At minimum:

```bash
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm test
pnpm build
```

If scripts are missing, add them.

If Playwright is added:

```bash
pnpm e2e
```

If lint/typecheck scripts are added:

```bash
pnpm lint
pnpm typecheck
```

Do not claim completion while any of these fail.

==================================================
PRODUCT-LEVEL VERIFICATION
==================================================

Automated tests are necessary but not sufficient.

Verify the product like a real user:

1. Start PostgreSQL.
2. Run migrations.
3. Seed data.
4. Start API.
5. Start web app.
6. Open the real local URL in a browser.
7. Log in as platform owner.
8. Log in as clinic owner.
9. Log in as patient.
10. Complete the required E2E journeys.
11. Test mobile viewport.
12. Test desktop viewport.
13. Capture screenshots for:
    - public homepage
    - marketplace results
    - clinic profile
    - booking flow
    - clinic dashboard overview
    - clinic appointments
    - clinic analytics
    - owner approvals
    - owner clinic detail
14. Verify error states:
    - invalid login
    - missing required booking fields
    - unauthorized dashboard access
    - unavailable appointment slot
15. Stop servers.
16. Confirm no orphan processes remain.

==================================================
SECURITY VERIFICATION
==================================================

Run concrete checks:

- Missing token on protected API returns 401.
- Invalid token returns 401.
- Wrong role returns 403.
- Wrong clinic membership returns 403 or 404 without leaking data.
- Clinic owner cannot approve own listing.
- Patient cannot access clinic appointments list.
- Private clinic does not appear in public search.
- Suspended clinic does not appear in public search.
- Password hash never appears in API response.
- Audit log is created for sensitive changes.

==================================================
SELF-REVIEW IMPROVEMENT LOOP
==================================================

After each feature, bugfix, UI change, security change, and verification failure, run this loop:

1. Does the implementation satisfy the requested behavior?
2. Does it fit the existing architecture?
3. Does it follow TypeScript, NestJS, Next.js, Prisma, and Tailwind best practices?
4. Are there hidden risks: security, data leaks, data loss, race conditions, double booking, weak validation, poor performance, accessibility, flaky tests, process leaks, or misleading docs?
5. If any answer is not supported by evidence, fix the implementation, tests, docs, or verification and rerun the relevant checks.
6. Stop only when no known release-blocking issue remains.

This loop must produce action. If it finds a risk, fix it or document it as a blocker with evidence.

==================================================
STRICT BOUNDARIES
==================================================

Do not:

- Build a demo-only product.
- Leave fake buttons or dead links in final pages.
- Store clinical/EMR data in MVP.
- Add AI diagnosis.
- Add native mobile or desktop app before web product is complete.
- Replace the chosen stack.
- Disable tests to pass.
- Hide verification failures.
- Delete migrations or data as a shortcut.
- Leave auth only on the frontend.
- Let clinic users query other clinics' data.
- Use placeholder-only templates.
- Claim production readiness without real browser verification.

Do:

- Make strong technical decisions without asking routine questions.
- Search official docs when needed.
- Install necessary dependencies.
- Set up the database.
- Write migrations.
- Write tests.
- Use browser/E2E verification.
- Improve weak existing code when it blocks the goal.
- Keep changes coherent with the monorepo.

==================================================
COMPLETION AUDIT
==================================================

Final response must include:

- Objective restated.
- Files changed.
- Features completed.
- Tests run with results.
- Build run with result.
- Database/migration status.
- E2E/manual browser verification summary.
- Screenshot paths.
- Security checks run.
- Process cleanup result.
- Remaining Partial/Blocked items with evidence.

For every major requirement, mark:

```txt
Complete
Partial
Blocked
Not Started
```

Do not use vague phrases like "should work", "mostly done", or "looks good" without evidence.

==================================================
EXPECTED END STATE
==================================================

The expected end state is:

- A user can visit MadarCare, search for clinics, open a clinic profile, and request an appointment.
- A clinic owner can register, configure a clinic, choose a premium template, add doctors/services/availability, manage appointments, manage patients, track revenue, and view analytics.
- A platform owner can approve/suspend/promote clinics and view platform analytics.
- The backend enforces auth, roles, tenant isolation, validation, appointment workflow rules, and audit logs.
- The database persists real data.
- The UI is premium and responsive.
- Tests and E2E checks pass.
- The product can be run locally from documented commands.

Continue until this end state is reached or a real blocker is proven with evidence.
