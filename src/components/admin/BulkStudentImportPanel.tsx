import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  Upload,
  XCircle,
} from 'lucide-react';
import { api } from '../../lib/api';
import type {
  BulkStudentImportInputRow,
  BulkStudentImportSummary,
  BulkStudentPreviewRow,
} from '../../types/hospital';

interface BulkStudentImportPanelProps {
  onImportComplete: () => Promise<void> | void;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 250;

function sanitizeCsvCell(raw: string | number | null | undefined): string {
  const str = String(raw ?? '');
  const formulaNeutralized = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  const escaped = formulaNeutralized.replace(/"/g, '""');
  return `"${escaped}"`;
}

function normalizeHeaderKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function formatExcelDateValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      const mm = String(parsed.m).padStart(2, '0');
      const dd = String(parsed.d).padStart(2, '0');
      return `${parsed.y}-${mm}-${dd}`;
    }
  }
  return String(value).trim();
}

function getFieldByAliases(record: Record<string, unknown>, aliases: string[]): string {
  for (const alias of aliases) {
    const val = record[alias];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim();
    }
  }
  return '';
}

function parseSheetRows(rawRows: Record<string, unknown>[]): BulkStudentImportInputRow[] {
  const parsed: BulkStudentImportInputRow[] = [];

  rawRows.forEach((rawObj, idx) => {
    const normalizedObj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(rawObj)) {
      normalizedObj[normalizeHeaderKey(key)] = val;
    }

    const full_name = getFieldByAliases(normalizedObj, [
      'full_name',
      'fullname',
      'name',
      'student_name',
    ]);
    const matric_number = getFieldByAliases(normalizedObj, [
      'matric_number',
      'matric_no',
      'matric',
      'matriculation_number',
      'matric_or_staff_id',
      'reg_no',
    ]);
    const department = getFieldByAliases(normalizedObj, [
      'department',
      'dept',
      'faculty_or_unit',
      'academic_department',
    ]);
    const email = getFieldByAliases(normalizedObj, [
      'email',
      'email_address',
      'student_email',
    ]);
    const password = getFieldByAliases(normalizedObj, ['password', 'temp_password']);
    const phone = getFieldByAliases(normalizedObj, ['phone', 'phone_number', 'mobile']);
    const gender = getFieldByAliases(normalizedObj, ['gender', 'sex']);
    const rawDob =
      normalizedObj.date_of_birth ??
      normalizedObj.dob ??
      normalizedObj.birth_date ??
      '';
    const date_of_birth = formatExcelDateValue(rawDob);
    const address = getFieldByAliases(normalizedObj, ['address', 'hostel', 'residential_address']);
    const blood_group = getFieldByAliases(normalizedObj, ['blood_group', 'bloodgroup', 'blood']);
    const genotype = getFieldByAliases(normalizedObj, ['genotype']);
    const allergies = getFieldByAliases(normalizedObj, ['allergies', 'allergy']);
    const emergency_contact_name = getFieldByAliases(normalizedObj, [
      'emergency_contact_name',
      'emergency_contact',
      'next_of_kin',
    ]);
    const emergency_contact_phone = getFieldByAliases(normalizedObj, [
      'emergency_contact_phone',
      'emergency_phone',
      'next_of_kin_phone',
    ]);

    const isBlankRow = !full_name && !matric_number && !department && !email;
    if (isBlankRow) return;

    parsed.push({
      row_number: idx + 2,
      full_name,
      matric_number,
      department,
      email,
      ...(password ? { password } : {}),
      ...(phone ? { phone } : {}),
      ...(gender ? { gender } : {}),
      ...(date_of_birth ? { date_of_birth } : {}),
      ...(address ? { address } : {}),
      ...(blood_group ? { blood_group } : {}),
      ...(genotype ? { genotype } : {}),
      ...(allergies ? { allergies } : {}),
      ...(emergency_contact_name ? { emergency_contact_name } : {}),
      ...(emergency_contact_phone ? { emergency_contact_phone } : {}),
    });
  });

  return parsed;
}

export function BulkStudentImportPanel({ onImportComplete }: BulkStudentImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState<BulkStudentImportInputRow[]>([]);
  const [previewRows, setPreviewRows] = useState<BulkStudentPreviewRow[]>([]);
  const [previewFilter, setPreviewFilter] = useState<'all' | 'valid' | 'duplicate' | 'invalid'>('all');
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [importSummary, setImportSummary] = useState<BulkStudentImportSummary | null>(null);

  const previewCounts = useMemo(() => {
    const valid = previewRows.filter((r) => r.status === 'valid').length;
    const duplicate = previewRows.filter((r) => r.status === 'duplicate').length;
    const invalid = previewRows.filter((r) => r.status === 'invalid').length;
    return { total: previewRows.length, valid, duplicate, invalid };
  }, [previewRows]);

  const filteredPreviewRows = useMemo(() => {
    if (previewFilter === 'all') return previewRows;
    return previewRows.filter((r) => r.status === previewFilter);
  }, [previewRows, previewFilter]);

  const handleDownloadTemplate = () => {
    const headers = [
      'full_name',
      'matric_number',
      'department',
      'email',
      'password',
      'phone',
      'gender',
      'date_of_birth',
      'address',
      'blood_group',
      'genotype',
      'allergies',
      'emergency_contact_name',
      'emergency_contact_phone',
    ];
    const sampleRows = [
      [
        'Amina Yusuf Kabir',
        'CSC/2024/41001',
        'Computer Science',
        'amina.kabir@fudma.edu.ng',
        '',
        '+2348031234567',
        'Female',
        '2004-05-14',
        'Katsina Female Hostel Block B',
        'O+',
        'AA',
        'None reported',
        'Kabir Yusuf',
        '+2348037654321',
      ],
      [
        'Sadiq Umar Bello',
        'ENG/2024/41002',
        'Civil Engineering',
        'sadiq.bello@fudma.edu.ng',
        'FudmaStudent#24',
        '+2348069876543',
        'Male',
        '2003-11-02',
        'Dutsin-Ma Campus Hostel 3',
        'A+',
        'AS',
        'Penicillin',
        'Umar Bello',
        '+2348061112233',
      ],
    ];

    const csvContent = [
      headers.map((h) => sanitizeCsvCell(h)).join(','),
      ...sampleRows.map((row) => row.map((cell) => sanitizeCsvCell(cell)).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fudma_student_bulk_import_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadImportReport = () => {
    if (!importSummary) return;
    const headers = [
      'row_number',
      'full_name',
      'matric_number',
      'email',
      'department',
      'status',
      'hospital_number',
      'temporary_password',
      'message',
    ];
    const lines = [
      headers.map((h) => sanitizeCsvCell(h)).join(','),
      ...importSummary.results.map((r) =>
        [
          r.row_number,
          r.full_name,
          r.matric_number,
          r.email,
          r.department,
          r.status,
          r.hospital_number || '',
          r.generated_password || '',
          r.message,
        ]
          .map((c) => sanitizeCsvCell(c))
          .join(',')
      ),
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fudma_student_import_report_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setFileName('');
    setParsedRows([]);
    setPreviewRows([]);
    setPreviewFilter('all');
    setError('');
    setImportSummary(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setImportSummary(null);
    setPreviewRows([]);
    setParsedRows([]);

    if (file.size > MAX_FILE_BYTES) {
      setError('Uploaded file exceeds the 5MB limit. Please split large batches.');
      return;
    }

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.csv') && !lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls')) {
      setError('Unsupported file format. Please upload a .csv, .xlsx, or .xls spreadsheet.');
      return;
    }

    setFileName(file.name);
    setValidating(true);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new Error('The uploaded spreadsheet does not contain any readable worksheet.');
      }

      const sheet = workbook.Sheets[firstSheetName];
      const rawRecords = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: '',
        raw: true,
      });

      const normalizedInput = parseSheetRows(rawRecords);
      if (normalizedInput.length === 0) {
        throw new Error(
          'No student rows were detected. Ensure columns include full_name, matric_number, department, and email.'
        );
      }
      if (normalizedInput.length > MAX_IMPORT_ROWS) {
        throw new Error(
          `Batch contains ${normalizedInput.length} rows, exceeding the ${MAX_IMPORT_ROWS}-row limit per upload.`
        );
      }

      setParsedRows(normalizedInput);
      const previewRes = await api.admin.bulkPreviewStudents(normalizedInput);
      setPreviewRows(previewRes.rows);
      setPreviewFilter('all');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to parse and validate uploaded spreadsheet.');
      setParsedRows([]);
      setPreviewRows([]);
    } finally {
      setValidating(false);
    }
  };

  const handleConfirmImport = async () => {
    if (parsedRows.length === 0 || previewCounts.valid === 0) return;
    setError('');
    setImporting(true);
    try {
      const res = await api.admin.bulkImportStudents(parsedRows);
      setImportSummary(res.summary);
      await onImportComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk student import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload & Template Card */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">Bulk Student Import (CSV / Excel)</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Upload a <span className="font-mono">.csv</span>, <span className="font-mono">.xlsx</span>, or{' '}
              <span className="font-mono">.xls</span> file (up to 250 students per batch). Every row is
              validated and checked for duplicate matriculation numbers or emails before saving.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-[#0F4C81]" />
            <span>Download CSV Template</span>
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800 flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="rounded-lg border-2 border-dashed border-slate-300 bg-slate-50/70 p-6 text-center space-y-3">
          <div className="mx-auto w-11 h-11 rounded-lg bg-sky-50 border border-sky-200 text-[#0F4C81] flex items-center justify-center">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">
              {fileName ? `Selected file: ${fileName}` : 'Select a CSV or Excel student roster'}
            </p>
            <p className="text-xs text-slate-500">
              Required columns: <span className="font-mono">full_name</span>,{' '}
              <span className="font-mono">matric_number</span>, <span className="font-mono">department</span>,{' '}
              <span className="font-mono">email</span>. Leave <span className="font-mono">password</span>{' '}
              blank to auto-generate strong unique passwords.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <label className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0369A1] cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>{validating ? 'Parsing & Validating...' : 'Choose CSV / Excel File'}</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                disabled={validating || importing}
                onChange={handleFileSelected}
                className="sr-only"
              />
            </label>
            {(fileName || previewRows.length > 0 || importSummary) && (
              <button
                type="button"
                disabled={validating || importing}
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Clear Batch</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Validation Loading */}
      {validating && (
        <div className="rounded-lg border border-slate-200 bg-white p-8 flex items-center justify-center gap-3 text-sm text-slate-600">
          <Loader2 className="w-5 h-5 animate-spin text-[#0F4C81]" />
          <span>Validating records and checking database for duplicate matriculation numbers and emails...</span>
        </div>
      )}

      {/* Pre-Save Preview Section */}
      {!validating && previewRows.length > 0 && !importSummary && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Pre-Import Validation Preview</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Review detected records before writing to Supabase Auth, profiles, patients, and whitelist. Duplicate or invalid rows are automatically skipped and will never overwrite existing accounts.
              </p>
            </div>
            <button
              type="button"
              disabled={importing || previewCounts.valid === 0}
              onClick={handleConfirmImport}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {importing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Importing Students...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Import {previewCounts.valid} Valid Student{previewCounts.valid === 1 ? '' : 's'}</span>
                </>
              )}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <span className="text-[11px] font-medium text-slate-500 block">Total Rows Parsed</span>
              <span className="text-xl font-bold font-mono text-slate-900">{previewCounts.total}</span>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <span className="text-[11px] font-medium text-emerald-700 block">Ready to Create</span>
              <span className="text-xl font-bold font-mono text-emerald-900">{previewCounts.valid}</span>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <span className="text-[11px] font-medium text-amber-800 block">Duplicates (Skipped)</span>
              <span className="text-xl font-bold font-mono text-amber-900">{previewCounts.duplicate}</span>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <span className="text-[11px] font-medium text-red-700 block">Validation Errors</span>
              <span className="text-xl font-bold font-mono text-red-900">{previewCounts.invalid}</span>
            </div>
          </div>

          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['all', 'valid', 'duplicate', 'invalid'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setPreviewFilter(tab)}
                className={`px-3 py-1 rounded-md text-xs font-semibold capitalize transition-colors ${
                  previewFilter === tab
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-slate-200 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-3">Row</th>
                  <th className="py-2.5 px-3">Full Name</th>
                  <th className="py-2.5 px-3">Matric No</th>
                  <th className="py-2.5 px-3">Department</th>
                  <th className="py-2.5 px-3">Email</th>
                  <th className="py-2.5 px-3">Password</th>
                  <th className="py-2.5 px-3">Validation Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredPreviewRows.map((row) => (
                  <tr key={row.row_number} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-3 font-mono text-slate-500">#{row.row_number}</td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900">
                      {row.normalized.full_name || '—'}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-800 whitespace-nowrap">
                      {row.normalized.matric_number || '—'}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700">{row.normalized.department || '—'}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">
                      {row.normalized.email || '—'}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      {row.normalized.has_custom_password ? 'Provided in file' : 'Auto-generate'}
                    </td>
                    <td className="py-2.5 px-3">
                      {row.status === 'valid' ? (
                        <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Ready</span>
                        </span>
                      ) : row.status === 'duplicate' ? (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-800">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Duplicate</span>
                          </span>
                          <p className="text-[11px] text-amber-800">{row.errors.join(' ')}</p>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-800">
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Invalid</span>
                          </span>
                          <p className="text-[11px] text-red-700">{row.errors.join(' ')}</p>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Post-Import Row-Level Success / Failure Report */}
      {importSummary && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Bulk Import Execution Report</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Download the import report CSV immediately if you need to distribute auto-generated temporary passwords to newly provisioned students.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadImportReport}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0369A1] whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Report &amp; Credentials CSV</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <span className="text-[11px] font-medium text-slate-500 block">Processed Rows</span>
              <span className="text-xl font-bold font-mono text-slate-900">{importSummary.total}</span>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <span className="text-[11px] font-medium text-emerald-700 block">Accounts Created</span>
              <span className="text-xl font-bold font-mono text-emerald-900">{importSummary.created}</span>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <span className="text-[11px] font-medium text-amber-800 block">Duplicates Skipped</span>
              <span className="text-xl font-bold font-mono text-amber-900">
                {importSummary.skipped_duplicate}
              </span>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <span className="text-[11px] font-medium text-red-700 block">Failed Rows</span>
              <span className="text-xl font-bold font-mono text-red-900">{importSummary.failed}</span>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-3">Row</th>
                  <th className="py-2.5 px-3">Student</th>
                  <th className="py-2.5 px-3">Matric No</th>
                  <th className="py-2.5 px-3">Hospital No</th>
                  <th className="py-2.5 px-3">Outcome</th>
                  <th className="py-2.5 px-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {importSummary.results.map((item) => (
                  <tr key={`${item.row_number}-${item.matric_number}`} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-3 font-mono text-slate-500">#{item.row_number}</td>
                    <td className="py-2.5 px-3">
                      <p className="font-semibold text-slate-900">{item.full_name || '—'}</p>
                      <p className="font-mono text-[11px] text-slate-500">{item.email || '—'}</p>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-800 whitespace-nowrap">
                      {item.matric_number || '—'}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-[#0F4C81] whitespace-nowrap">
                      {item.hospital_number || '—'}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {item.status === 'created' ? (
                        <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Created</span>
                        </span>
                      ) : item.status === 'skipped_duplicate' ? (
                        <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-800">
                          <AlertCircle className="w-3.5 h-3.5" />
                          <span>Skipped Duplicate</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-800">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Failed</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700">{item.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
