import { ConnectedGoogleForm, StudentRecord } from './formsApi';

const STUDENTS_STORAGE_KEY = 'kinderroster_students_v1';
const CONNECTED_FORM_STORAGE_KEY = 'kinderroster_connected_form_v1';

const INITIAL_KINDERGARTEN_ROSTER: StudentRecord[] = [
  {
    id: 'kg-seed-101',
    studentIdCode: 'KG-26001',
    fullName: 'Amina Muhidin',
    gender: 'Girl',
    classroomGroup: 'Kindergarten Room A (Morning)',
    source: 'Direct Entry',
    registeredAt: '2026-10-20T08:30:00.000Z',
  },
  {
    id: 'kg-seed-102',
    studentIdCode: 'KG-26002',
    fullName: 'Lucas Vance',
    gender: 'Boy',
    classroomGroup: 'Kindergarten Room A (Morning)',
    source: 'Direct Entry',
    registeredAt: '2026-10-20T09:14:00.000Z',
  },
  {
    id: 'kg-seed-103',
    studentIdCode: 'KG-26003',
    fullName: 'Zainab Al-Mansoor',
    gender: 'Girl',
    classroomGroup: 'Kindergarten Room A (Morning)',
    source: 'Direct Entry',
    registeredAt: '2026-10-21T10:05:00.000Z',
  },
  {
    id: 'kg-seed-104',
    studentIdCode: 'KG-26004',
    fullName: 'Mateo Rivera',
    gender: 'Boy',
    classroomGroup: 'Kindergarten Room B (Afternoon)',
    source: 'Direct Entry',
    registeredAt: '2026-10-21T13:20:00.000Z',
  },
  {
    id: 'kg-seed-105',
    studentIdCode: 'KG-26005',
    fullName: 'Hannah Lindqvist',
    gender: 'Girl',
    classroomGroup: 'Kindergarten Room B (Afternoon)',
    source: 'Direct Entry',
    registeredAt: '2026-10-22T08:45:00.000Z',
  },
  {
    id: 'kg-seed-106',
    studentIdCode: 'KG-26006',
    fullName: 'Ibrahim Abdi',
    gender: 'Boy',
    classroomGroup: 'Kindergarten Room A (Morning)',
    source: 'Direct Entry',
    registeredAt: '2026-10-23T11:10:00.000Z',
  },
];

export function loadStoredStudents(): StudentRecord[] {
  try {
    const raw = localStorage.getItem(STUDENTS_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STUDENTS_STORAGE_KEY, JSON.stringify(INITIAL_KINDERGARTEN_ROSTER));
      return INITIAL_KINDERGARTEN_ROSTER;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : INITIAL_KINDERGARTEN_ROSTER;
  } catch {
    return INITIAL_KINDERGARTEN_ROSTER;
  }
}

export function saveStoredStudents(records: StudentRecord[]): void {
  try {
    localStorage.setItem(STUDENTS_STORAGE_KEY, JSON.stringify(records));
  } catch (err) {
    console.error('Failed to persist student records:', err);
  }
}

/**
 * Merges incoming Google Forms student responses with existing database records,
 * deduplicating by responseId + formId while preserving direct entries and edits.
 */
export function mergeFormResponsesIntoDatabase(
  existing: StudentRecord[],
  incomingFormRecords: StudentRecord[],
  formId: string
): { merged: StudentRecord[]; addedCount: number; updatedCount: number } {
  const byId = new Map<string, StudentRecord>();
  for (const item of existing) {
    byId.set(item.id, item);
  }

  let addedCount = 0;
  let updatedCount = 0;

  for (const incoming of incomingFormRecords) {
    if (byId.has(incoming.id)) {
      const prev = byId.get(incoming.id)!;
      if (prev.fullName !== incoming.fullName || prev.gender !== incoming.gender) {
        updatedCount++;
      }
      byId.set(incoming.id, {
        ...prev,
        fullName: incoming.fullName,
        gender: incoming.gender,
        registeredAt: incoming.registeredAt,
        formId,
      });
    } else {
      addedCount++;
      byId.set(incoming.id, incoming);
    }
  }

  const merged = Array.from(byId.values()).sort(
    (a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime()
  );

  saveStoredStudents(merged);
  return { merged, addedCount, updatedCount };
}

export function loadConnectedForm(): ConnectedGoogleForm | null {
  try {
    const raw = localStorage.getItem(CONNECTED_FORM_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ConnectedGoogleForm;
  } catch {
    return null;
  }
}

export function saveConnectedForm(form: ConnectedGoogleForm | null): void {
  try {
    if (!form) {
      localStorage.removeItem(CONNECTED_FORM_STORAGE_KEY);
    } else {
      localStorage.setItem(CONNECTED_FORM_STORAGE_KEY, JSON.stringify(form));
    }
  } catch (err) {
    console.error('Failed to save connected form metadata:', err);
  }
}

export function exportStudentsToCsv(students: StudentRecord[]): void {
  const headers = [
    'Student ID',
    'Full Name',
    'Gender',
    'Classroom Group',
    'Registration Source',
    'Google Form Response ID',
    'Registered Timestamp',
  ];

  const escapeCsvCell = (val: string) => `"${String(val ?? '').replace(/"/g, '""')}"`;

  const rows = students.map((s) =>
    [
      s.studentIdCode,
      s.fullName,
      s.gender,
      s.classroomGroup,
      s.source,
      s.responseId || 'N/A',
      new Date(s.registeredAt).toISOString(),
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  const csvString = [headers.map(escapeCsvCell).join(','), ...rows].join('\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute(
    'download',
    `kindergarten-student-database-${new Date().toISOString().slice(0, 10)}.csv`
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
