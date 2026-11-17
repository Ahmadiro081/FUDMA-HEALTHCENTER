# FUDMA HEALTHCENTER
**Hospital Appointment Booking and Patient Management System**  
*Federal University Dutsin-Ma (FUDMA) — Academic Mini Project*

---

## Architecture Overview

FUDMA HEALTHCENTER coordinates the end-to-end campus hospital workflow across six role-scoped portals:

1. **Patient Portal**: Self-registration, appointment booking with available slots and consultation categories, cancellation when permitted, consultation history, laboratory results, and prescriptions.
2. **Nursing Station (Reception & Triage)**: Registered patient search, walk-in registration, identity verification, appointment check-in, waiting queue prioritization, vital signs entry, and doctor allocation.
3. **Consultant / Doctor Workspace**: Assigned appointments, checked-in waiting queue, patient medical records, clinical observations, diagnosis, laboratory test requests, result review, medication prescribing, and follow-up scheduling.
4. **Medical Laboratory**: Incoming lab test queue (`Pending` → `Sample Collected` → `Processing` → `Completed` → `Reviewed`), diagnostic findings & reference range entry, and submission for doctor review.
5. **Hospital Pharmacy**: Incoming prescriptions (`Pending` → `Available` / `Partially Dispensed` / `Dispensed` / `Unavailable`), stock verification, dispensing records, and drug inventory management.
6. **System Administrator**: Hospital-wide analytics, staff account provisioning with role assignment, department management, activity audit logs, and system settings.

---

## Free-Tier Technology & Cost Compliance

Designed strictly around free-tier infrastructure:
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS + Lucide React + Recharts.
- **Database & Auth**: Supabase Free Tier (PostgreSQL + Supabase Auth + Row Level Security) with full SQL migrations in `/supabase/migrations/`.
- **Standalone / Local Backend Mode**: Express (`server.ts`) with scrypt password hashing, HMAC-signed session tokens, and persistent local storage (`data/fudma_healthcenter.json`) when Supabase environment variables are not configured.
- **Hosting**: Vercel Free Tier (`vercel.json` included for SPA routing).
- **Zero Paid Services**: No AI APIs, no paid SMS gateways, and no paid email providers. All notifications operate via an in-app database notification system.

### Free-Tier Service Limitations
- **Supabase Free Tier**: 500 MB database storage, 50,000 monthly active users, and automatic project pausing after 7 days of inactivity on unused projects.
- **Vercel Free (Hobby) Tier**: Non-commercial academic usage, 100 GB bandwidth/month, serverless function execution limits.

---

## Supabase & Vercel Deployment Setup

1. Create a free Supabase project at [supabase.com](https://supabase.com).
2. Run the three SQL migration files in order inside the Supabase SQL Editor:
   - `supabase/migrations/001_schema.sql`
   - `supabase/migrations/002_rls_policies.sql`
   - `supabase/migrations/003_seed_data.sql`
3. Copy `.env.example` to `.env` and set:
   ```env
   VITE_SUPABASE_URL="https://your-project-id.supabase.co"
   VITE_SUPABASE_ANON_KEY="your-public-anon-key"
   ```
   *(Never expose the Supabase `service_role` key in frontend code.)*
4. Push to GitHub and import the repository in Vercel with the two `VITE_SUPABASE_*` environment variables configured.
