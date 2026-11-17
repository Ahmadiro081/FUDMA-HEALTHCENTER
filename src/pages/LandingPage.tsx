import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  CalendarCheck,
  Clock,
  Cross,
  FlaskConical,
  HeartPulse,
  MapPin,
  Phone,
  Pill,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react';
import { getRoleDashboardPath, useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type { Department, SystemSettings } from '../types/hospital';

const WORKFLOW_STEPS = [
  {
    step: '01',
    title: 'Patient Registration',
    desc: 'Students, staff, and dependents create a verified digital patient file with university ID and medical profile.',
  },
  {
    step: '02',
    title: 'Appointment Booking',
    desc: 'Select a clinical department, consultation category, available date, and time slot from any device.',
  },
  {
    step: '03',
    title: 'Nursing Station Triage',
    desc: 'Arrival check-in, vital signs recording, priority assessment, and queue allocation to an available doctor.',
  },
  {
    step: '04',
    title: 'Consultant Examination',
    desc: 'Medical officers review vitals and medical history, document clinical findings, and record diagnoses.',
  },
  {
    step: '05',
    title: 'Medical Laboratory',
    desc: 'Diagnostic test requests move seamlessly from sample collection through processing to verified results.',
  },
  {
    step: '06',
    title: 'Consultant Review',
    desc: 'Doctors review submitted laboratory reports and finalize or adjust the patient treatment plan.',
  },
  {
    step: '07',
    title: 'Pharmacy Dispensary',
    desc: 'Pharmacists verify medication stock availability, dispense prescriptions, and update inventory in real time.',
  },
  {
    step: '08',
    title: 'Completed Care Record',
    desc: 'Consultations conclude with full patient access to visit summaries, lab outcomes, and prescriptions.',
  },
];

export function LandingPage() {
  const { user } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api.reference.departments().then((r) => setDepartments(r.departments)).catch(() => {});
    api.reference.publicSettings().then((r) => setSettings(r.settings)).catch(() => {});
  }, []);

  const markImgError = (key: string) => {
    setImgErrors((prev) => ({ ...prev, [key]: true }));
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <Link
            to="/"
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-[#0F4C81] whitespace-nowrap shrink-0"
          >
            <span className="w-8 h-8 rounded-lg bg-[#0F4C81] text-white flex items-center justify-center shrink-0">
              <Cross className="w-4 h-4" />
            </span>
            <span>FUDMA HEALTHCENTER</span>
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <a href="#services" className="hover:text-[#0F4C81] hover:underline underline-offset-4 whitespace-nowrap shrink-0">
              Services
            </a>
            <a href="#workflow" className="hover:text-[#0F4C81] hover:underline underline-offset-4 whitespace-nowrap shrink-0">
              Workflow
            </a>
            <a href="#departments" className="hover:text-[#0F4C81] hover:underline underline-offset-4 whitespace-nowrap shrink-0">
              Departments
            </a>
            <a href="#contact" className="hover:text-[#0F4C81] hover:underline underline-offset-4 whitespace-nowrap shrink-0">
              Contact
            </a>
          </nav>

          <div className="shrink-0">
            <Link
              to={user ? getRoleDashboardPath(user.role) : '/login'}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0F4C81] text-white text-sm font-semibold hover:bg-[#0369A1] transition-colors whitespace-nowrap shrink-0"
            >
              <span>{user ? 'Open Portal' : 'Patient Portal'}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 lg:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="text-sm font-semibold text-[#0D9488] tracking-tight">
                Federal University Dutsin-Ma · University Health Services
              </p>
              <h1 className="mt-3 text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 leading-[1.12]">
                Coordinated Campus Healthcare &amp; Patient Management
              </h1>
              <p className="mt-4 text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl">
                Book outpatient appointments, track nursing triage and waiting queues, review verified
                laboratory diagnostics, and collect pharmacy prescriptions through one unified hospital platform.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  to={user ? getRoleDashboardPath(user.role) : '/register'}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#0F4C81] text-white text-sm font-semibold hover:bg-[#0369A1] transition-colors whitespace-nowrap"
                >
                  <span>{user ? 'Go to Dashboard' : 'Register & Book Appointment'}</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/login"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-slate-300 bg-white text-slate-800 text-sm font-semibold hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  <span>Staff &amp; Patient Sign In</span>
                </Link>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="h-full min-h-[280px] sm:min-h-[340px] rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                {imgErrors.hero ? (
                  <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-gradient-to-br from-sky-50 to-teal-50 text-center">
                    <Building2 className="w-12 h-12 text-[#0F4C81] mb-3" />
                    <p className="text-base font-semibold text-slate-900">FUDMA Healthcenter Medical Complex</p>
                    <p className="text-sm text-slate-600 mt-1">Federal University Dutsin-Ma, Katsina State</p>
                  </div>
                ) : (
                  <img
                    src="/src/assets/images/fudma_health_campus_1794895509779.jpg"
                    alt="FUDMA Healthcenter medical pavilion at Federal University Dutsin-Ma"
                    referrerPolicy="no-referrer"
                    onError={() => markImgError('hero')}
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
            </div>
          </div>

          {/* 4-column summary strip below hero split */}
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#0F4C81]">
                <Clock className="w-4 h-4 shrink-0" />
                <span>Clinic Operating Hours</span>
              </div>
              <p className="mt-1.5 text-sm font-semibold text-slate-900">
                {settings?.clinic_hours || '08:00 - 18:00 (24/7 Emergency)'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#0D9488]">
                <Building2 className="w-4 h-4 shrink-0" />
                <span>Clinical Units</span>
              </div>
              <p className="mt-1.5 text-sm font-semibold text-slate-900 tabular-nums">
                {departments.length || 5} Integrated Hospital Departments
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#0F4C81]">
                <CalendarCheck className="w-4 h-4 shrink-0" />
                <span>Daily Slot Capacity</span>
              </div>
              <p className="mt-1.5 text-sm font-semibold text-slate-900 tabular-nums">
                Up to {settings?.max_daily_appointments || 120} Appointments / Day
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#0D9488]">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Role-Protected Records</span>
              </div>
              <p className="mt-1.5 text-sm font-semibold text-slate-900">
                Scoped Access Across 6 Clinical Portals
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Core Services Bento */}
      <section id="services" className="py-16 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Integrated Clinical Portals
            </h2>
            <p className="mt-2 text-base text-slate-600">
              Every department operates on shared patient records with clear handoffs from reception to pharmacy.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col">
              <div className="h-52 bg-slate-100 overflow-hidden">
                {imgErrors.consult ? (
                  <div className="w-full h-full flex items-center justify-center bg-sky-50">
                    <Stethoscope className="w-10 h-10 text-[#0F4C81]" />
                  </div>
                ) : (
                  <img
                    src="/src/assets/images/clinical_consultation_1794895494253.jpg"
                    alt="Doctor consulting with student patient at FUDMA Healthcenter"
                    referrerPolicy="no-referrer"
                    onError={() => markImgError('consult')}
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
              <div className="p-6 flex-1 flex flex-col">
                <p className="text-xs font-semibold text-[#0F4C81]">01. Outpatient &amp; Nursing Triage</p>
                <h3 className="mt-1.5 text-lg font-bold text-slate-900">
                  Reception, Vitals &amp; Doctor Consultations
                </h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  Nurses verify booked and walk-in patients, log blood pressure, temperature, SpO2, and pulse,
                  and route waiting patients directly to assigned medical officers.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col">
              <div className="h-52 bg-slate-100 overflow-hidden">
                {imgErrors.lab ? (
                  <div className="w-full h-full flex items-center justify-center bg-teal-50">
                    <FlaskConical className="w-10 h-10 text-[#0D9488]" />
                  </div>
                ) : (
                  <img
                    src="/src/assets/images/diagnostic_laboratory_1794895493380.jpg"
                    alt="FUDMA Medical Laboratory diagnostic bench"
                    referrerPolicy="no-referrer"
                    onError={() => markImgError('lab')}
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
              <div className="p-6 flex-1 flex flex-col">
                <p className="text-xs font-semibold text-[#0D9488]">02. Medical Laboratory</p>
                <h3 className="mt-1.5 text-lg font-bold text-slate-900">
                  Diagnostic Orders &amp; Verified Results
                </h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  Laboratory scientists receive consultant test orders, update sample status from collection to
                  processing, and submit structured findings with reference ranges.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col">
              <div className="h-52 bg-slate-100 overflow-hidden">
                {imgErrors.pharmacy ? (
                  <div className="w-full h-full flex items-center justify-center bg-sky-50">
                    <Pill className="w-10 h-10 text-[#0F4C81]" />
                  </div>
                ) : (
                  <img
                    src="/src/assets/images/hospital_pharmacy_1794895493342.jpg"
                    alt="FUDMA Hospital Pharmacy and Dispensary"
                    referrerPolicy="no-referrer"
                    onError={() => markImgError('pharmacy')}
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
              <div className="p-6 flex-1 flex flex-col">
                <p className="text-xs font-semibold text-[#0F4C81]">03. Pharmacy &amp; Inventory</p>
                <h3 className="mt-1.5 text-lg font-bold text-slate-900">
                  Prescription Fulfillment &amp; Stock Control
                </h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  Pharmacists verify medication availability against live dispensary stock, dispense full or
                  partial orders, and automatically alert patients when ready.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 8-Step Hospital Workflow */}
      <section id="workflow" className="py-16 bg-slate-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              End-to-End Clinical Workflow
            </h2>
            <p className="mt-2 text-base text-slate-600">
              Eight structured operational stages connect every patient visit from registration to discharge.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {WORKFLOW_STEPS.map((item) => (
              <div key={item.step} className="rounded-lg border border-slate-200 bg-white p-5">
                <span className="font-mono text-xs font-semibold text-[#0D9488] tabular-nums">
                  Step {item.step}
                </span>
                <h3 className="mt-2 text-base font-bold text-slate-900">{item.title}</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Departments Directory */}
      <section id="departments" className="py-16 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                Clinical Departments
              </h2>
              <p className="mt-2 text-base text-slate-600">
                Active medical units serving the Federal University Dutsin-Ma community.
              </p>
            </div>
            <Link
              to="/register"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0F4C81] hover:underline whitespace-nowrap"
            >
              <span>Book a Department Visit</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {departments
              .filter((d) => d.is_active)
              .map((dept) => (
                <div key={dept.id} className="rounded-lg border border-slate-200 bg-white p-5">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="font-mono font-semibold text-[#0F4C81]">{dept.code}</span>
                    <span>{dept.location || 'Main Campus Clinic'}</span>
                  </div>
                  <h3 className="mt-2 text-base font-bold text-slate-900">{dept.name}</h3>
                  <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{dept.description}</p>
                </div>
              ))}
          </div>
        </div>
      </section>

      {/* Quiet Institutional Footer */}
      <footer id="contact" className="bg-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-8 border-b border-slate-200">
            <div>
              <div className="flex items-center gap-2 text-base font-bold text-[#0F4C81]">
                <HeartPulse className="w-5 h-5" />
                <span>FUDMA HEALTHCENTER</span>
              </div>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                University Health Services, Federal University Dutsin-Ma, Katsina State, Nigeria.
              </p>
            </div>
            <div className="space-y-2 text-sm text-slate-600">
              <p className="font-semibold text-slate-900">Clinic Location &amp; Desk</p>
              <p className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                <span>Main Campus Medical Complex, Dutsin-Ma</span>
              </p>
              <p className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                <span>Emergency Triage Desk · +234 (0) 800 383 6242</span>
              </p>
            </div>
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-slate-900">Portal Access</p>
              <div className="flex flex-col gap-1.5 text-slate-600">
                <Link to="/register" className="hover:text-[#0F4C81]">
                  New Patient Registration
                </Link>
                <Link to="/login" className="hover:text-[#0F4C81]">
                  Patient &amp; Staff Sign In
                </Link>
                <Link to="/reset-password" className="hover:text-[#0F4C81]">
                  Reset Account Password
                </Link>
              </div>
            </div>
          </div>
          <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
            <p>
              &copy; {new Date().getFullYear()} FUDMA HEALTHCENTER · Federal University Dutsin-Ma Academic Project
            </p>
            <p>Fictional demonstration dataset · Designed for free-tier Supabase &amp; Vercel deployment</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
