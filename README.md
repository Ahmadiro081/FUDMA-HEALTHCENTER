# FUDMA HEALTHCENTER
**Hospital Appointment Booking and Patient Management System**  
*Federal University Dutsin-Ma (FUDMA) — Academic Mini Project*

---

## Architecture Overview

FUDMA HEALTHCENTER coordinates the end-to-end campus hospital workflow across six role-scoped portals:

1. **Patient Portal**: Self-registration, appointment booking with available slots and consultation categories, cancellation when permitted, consultation history, laboratory results, and prescriptions.
2. **Nursing Station (Reception & Triage)**: Registered patient search, walk-in registration, identity verification, appointment check-in, waiting queue prioritization, vital signs entry, and doctor allocation.
3. **Consultant / Doctor Workspace**: Assigned appointments, checked-in waiting queue, patient medical records, clinical observations, diagnosis, laboratory test requests, result review, medication prescribing, and follow-up scheduling.
4. **Medical Laboratory**: Incoming lab test queue (`Pending` -> `Sample Collected` -> `Processing` -> `Completed` -> `Reviewed`), diagnostic findings & reference range entry, and submission for doctor review.
5. **Hospital Pharmacy**: Incoming prescriptions (`Pending` -> `Available` / `Partially Dispensed` / `Dispensed` / `Unavailable`), stock verification, atomic dispensing records, and drug inventory management.
6. **System Administrator**: Hospital-wide analytics, server-verified staff account provisioning with role assignment, department management, activity audit logs, and system settings.

---

## Free-Tier Technology & Cost Compliance

Designed strictly around free-tier infrastructure:
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS + Lucide React + Recharts.
- **Database & Auth (Production)**: Supabase Free Tier (PostgreSQL + Supabase Auth + Row Level Security + `SECURITY DEFINER` transactional RPCs) with SQL migrations in `/supabase/migrations/`.
- **Server-Side Staff Provisioning**: Vercel Serverless Function (`/api/admin/staff.ts`) + matching Express endpoint (`server.ts`) using `SUPABASE_SERVICE_ROLE_KEY` strictly on the server after verifying the caller's Supabase JWT and `admin` role in `user_roles`.
- **Isolated Local Development Fallback**: Express (`server.ts`) + local JSON (`data/fudma_healthcenter.json`) is strictly restricted to non-production development when `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are not configured. Production builds disable local JSON fallback.
- **Hosting**: Vercel Free Tier (`vercel.json` routes `/api/*` to serverless functions and all other routes to the SPA).
- **Zero Paid Services**: No AI APIs, no paid SMS gateways, and no paid email providers. All notifications operate via an in-app PostgreSQL notification system.

### Free-Tier Service Limitations
- **Supabase Free Tier**: 500 MB database storage, 50,000 monthly active users, and automatic project pausing after 7 days of inactivity on unused projects.
- **Vercel Free (Hobby) Tier**: Non-commercial academic usage, 100 GB bandwidth/month, serverless function execution limits.

---

## Supabase & Vercel Setup Guide

1. Create a free Supabase project at [supabase.com](https://supabase.com).
2. Run all four SQL migration files **in order** inside the Supabase SQL Editor:
   - `supabase/migrations/001_schema.sql`
   - `supabase/migrations/002_rls_policies.sql`
   - `supabase/migrations/003_seed_data.sql`
   - `supabase/migrations/004_rpc_and_hardening.sql`
3. Configure Authentication Redirect URLs in Supabase Dashboard -> Authentication -> URL Configuration:
   - Site URL: your Vercel or local URL (e.g., `https://your-app.vercel.app` or `http://localhost:3000`)
   - Redirect URLs: `/login` and `/reset-password`
4. Copy `.env.example` to `.env` (or configure in Vercel Project Settings -> Environment Variables):
   ```env
   VITE_SUPABASE_URL="https://your-project-id.supabase.co"
   VITE_SUPABASE_ANON_KEY="your-public-anon-key"
   SUPABASE_SERVICE_ROLE_KEY="your-server-only-service-role-key"
   ```
   *(CRITICAL: Never prefix `SUPABASE_SERVICE_ROLE_KEY` with `VITE_` or expose it in frontend code.)*

### First Administrator Account Bootstrap
Public registration always assigns the `'patient'` role. To bootstrap your first System Administrator in a fresh Supabase project:
1. Register an account via `/register` or create a user in Supabase Dashboard -> Authentication -> Users.
2. Promote that user to `'admin'` once in the Supabase SQL Editor:
   ```sql
   UPDATE public.user_roles
   SET role = 'admin'
   WHERE user_id = (SELECT id FROM public.profiles WHERE email = 'admin@fudma.edu.ng');

   DELETE FROM public.patients
   WHERE profile_id = (SELECT id FROM public.profiles WHERE email = 'admin@fudma.edu.ng');
   ```
3. Sign in at `/login` as that administrator and use the **System Administrator -> Staff Accounts** portal (`/admin`) to provision Nursing, Doctor, Laboratory, Pharmacy, and additional Admin staff accounts securely via `/api/admin/staff`.
