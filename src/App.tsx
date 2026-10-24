/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import {
  Search,
  RefreshCw,
  FileSpreadsheet,
  Plus,
  ExternalLink,
  Copy,
  Check,
  Trash2,
  ArrowUpDown,
  FileText,
  UserPlus,
  SlidersHorizontal,
  AlertTriangle,
  LogOut,
  Edit3,
  X,
} from 'lucide-react';
import {
  initAuth,
  googleSignIn,
  getAccessToken,
  logout,
} from './lib/auth';
import {
  StudentRecord,
  ConnectedGoogleForm,
  createKindergartenGoogleForm,
  fetchGoogleFormById,
  fetchGoogleFormResponses,
  updateGoogleFormInfo,
  extractFormId,
} from './lib/formsApi';
import {
  loadStoredStudents,
  saveStoredStudents,
  mergeFormResponsesIntoDatabase,
  loadConnectedForm,
  saveConnectedForm,
  exportStudentsToCsv,
} from './lib/storage';

type GenderFilter = 'ALL' | 'Boy' | 'Girl';
type SourceFilter = 'ALL' | 'Google Forms' | 'Direct Entry';
type SortField = 'registeredAt' | 'fullName' | 'gender' | 'studentIdCode';
type SortDirection = 'asc' | 'desc';

interface ConfirmationModalState {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  isDestructive: boolean;
  onConfirm: () => Promise<void> | void;
}

const CLASSROOM_GROUPS = [
  'Kindergarten Room A (Morning)',
  'Kindergarten Room B (Afternoon)',
  'Kindergarten Room C (Full Day)',
];

function GoogleSignInButton({
  onClick,
  disabled,
  label = 'Sign in with Google',
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="gsi-material-button shrink-0"
    >
      <div className="gsi-material-button-state"></div>
      <div className="gsi-material-button-content-wrapper">
        <div className="gsi-material-button-icon">
          <svg
            version="1.1"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 48 48"
            style={{ display: 'block' }}
          >
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            ></path>
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            ></path>
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            ></path>
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            ></path>
            <path fill="none" d="M0 0h48v48H0z"></path>
          </svg>
        </div>
        <span className="gsi-material-button-contents">{label}</span>
        <span style={{ display: 'none' }}>{label}</span>
      </div>
    </button>
  );
}

export default function App() {
  // Auth state
  const [needsAuth, setNeedsAuth] = useState<boolean>(true);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  // Database state
  const [students, setStudents] = useState<StudentRecord[]>(() => loadStoredStudents());
  const [connectedForm, setConnectedForm] = useState<ConnectedGoogleForm | null>(() =>
    loadConnectedForm()
  );

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('ALL');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('ALL');
  const [classroomFilter, setClassroomFilter] = useState<string>('ALL');
  const [sortField, setSortField] = useState<SortField>('registeredAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Direct student registration form state
  const [directName, setDirectName] = useState<string>('');
  const [directGender, setDirectGender] = useState<'Boy' | 'Girl'>('Girl');
  const [directClassroom, setDirectClassroom] = useState<string>(CLASSROOM_GROUPS[0]);
  const [directEntryMessage, setDirectEntryMessage] = useState<string | null>(null);

  // Edit existing student record state
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [editStudentName, setEditStudentName] = useState<string>('');
  const [editStudentGender, setEditStudentGender] = useState<'Boy' | 'Girl'>('Girl');
  const [editStudentClassroom, setEditStudentClassroom] = useState<string>(CLASSROOM_GROUPS[0]);

  // Google Forms Builder & Sync state
  const [formBuilderMode, setFormBuilderMode] = useState<'create' | 'connect' | 'edit'>('create');
  const [newFormTitle, setNewFormTitle] = useState<string>(
    'Kindergarten Class Student Registration (Name & Gender)'
  );
  const [newFormDescription, setNewFormDescription] = useState<string>(
    'Official Kindergarten Class Roster Form. Please enter the student full name and select their gender.'
  );
  const [defaultSyncClassroom, setDefaultSyncClassroom] = useState<string>(CLASSROOM_GROUPS[0]);
  const [existingFormInput, setExistingFormInput] = useState<string>('');

  // Async operation states
  const [isCreatingForm, setIsCreatingForm] = useState<boolean>(false);
  const [isSyncingResponses, setIsSyncingResponses] = useState<boolean>(false);
  const [isUpdatingForm, setIsUpdatingForm] = useState<boolean>(false);
  const [workspaceFeedback, setWorkspaceFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);
  const [copiedUrlField, setCopiedUrlField] = useState<'responder' | 'edit' | 'id' | null>(null);

  // Confirmation modal state (Mandatory for destructive / mutating actions)
  const [confirmModal, setConfirmModal] = useState<ConfirmationModalState>({
    isOpen: false,
    title: '',
    description: '',
    confirmLabel: 'Confirm',
    isDestructive: false,
    onConfirm: () => {},
  });

  useEffect(() => {
    const unsubscribe = initAuth(
      (authedUser, accessToken) => {
        setUser(authedUser);
        setToken(accessToken);
        setNeedsAuth(false);
      },
      () => {
        setUser(null);
        setToken(null);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setWorkspaceFeedback(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setToken(result.accessToken);
        setNeedsAuth(false);
        setWorkspaceFeedback({
          type: 'success',
          text: `Signed in as ${result.user.email || result.user.displayName || 'Google Workspace user'}. Google Forms integration is ready.`,
        });
      }
    } catch (err: any) {
      setWorkspaceFeedback({
        type: 'error',
        text: err?.message || 'Google Sign-In was cancelled or could not complete.',
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setToken(null);
    setNeedsAuth(true);
    setWorkspaceFeedback({
      type: 'info',
      text: 'Signed out of Google Workspace. Your local student directory remains accessible.',
    });
  };

  // Create a new Google Form for Kindergarten Name & Gender Registration
  const handleCreateGoogleForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const activeToken = token || (await getAccessToken());
    if (!activeToken) {
      setNeedsAuth(true);
      setWorkspaceFeedback({
        type: 'error',
        text: 'Please sign in with Google first to create a Google Form in your account.',
      });
      return;
    }

    setIsCreatingForm(true);
    setWorkspaceFeedback(null);
    try {
      const created = await createKindergartenGoogleForm(activeToken, {
        title: newFormTitle,
        description: newFormDescription,
        classroomGroup: defaultSyncClassroom,
        genderLabels: ['Boy', 'Girl'],
      });
      setConnectedForm(created);
      saveConnectedForm(created);
      setNewFormTitle(created.title);
      setNewFormDescription(created.description);
      setWorkspaceFeedback({
        type: 'success',
        text: `Created Google Form "${created.title}" with required Student Full Name and Student Gender fields.`,
      });
    } catch (err: any) {
      if (String(err?.message || '').includes('401')) {
        setNeedsAuth(true);
      }
      setWorkspaceFeedback({
        type: 'error',
        text: err?.message || 'Failed to create Google Form.',
      });
    } finally {
      setIsCreatingForm(false);
    }
  };

  // Connect an existing Google Form by ID or Edit URL
  const handleConnectExistingForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const { formId, isResponderUrlError } = extractFormId(existingFormInput);

    if (isResponderUrlError) {
      setWorkspaceFeedback({
        type: 'error',
        text: 'You pasted a public responder URL (/forms/d/e/...). The Google Forms API requires the editor URL (/forms/d/<FORM_ID>/edit) or the Form ID from the editor address bar.',
      });
      return;
    }

    if (!formId) {
      setWorkspaceFeedback({
        type: 'error',
        text: 'Please enter a valid Google Form ID or Google Forms editor URL.',
      });
      return;
    }

    const activeToken = token || (await getAccessToken());
    if (!activeToken) {
      setNeedsAuth(true);
      setWorkspaceFeedback({
        type: 'error',
        text: 'Please sign in with Google first to connect and read your Google Form.',
      });
      return;
    }

    setIsSyncingResponses(true);
    setWorkspaceFeedback(null);
    try {
      const formMeta = await fetchGoogleFormById(activeToken, formId);
      setConnectedForm(formMeta);
      saveConnectedForm(formMeta);
      setNewFormTitle(formMeta.title);
      setNewFormDescription(formMeta.description);

      const responses = await fetchGoogleFormResponses(
        activeToken,
        formMeta,
        defaultSyncClassroom
      );
      const { merged, addedCount, updatedCount } = mergeFormResponsesIntoDatabase(
        students,
        responses,
        formMeta.formId
      );
      setStudents(merged);
      setExistingFormInput('');
      setWorkspaceFeedback({
        type: 'success',
        text: `Connected "${formMeta.title}". Synced ${responses.length} form response(s) (${addedCount} new, ${updatedCount} updated).`,
      });
    } catch (err: any) {
      if (String(err?.message || '').includes('401')) {
        setNeedsAuth(true);
      }
      setWorkspaceFeedback({
        type: 'error',
        text: err?.message || 'Failed to connect Google Form. Verify the Form ID and permissions.',
      });
    } finally {
      setIsSyncingResponses(false);
    }
  };

  // Sync responses from the currently connected Google Form
  const handleSyncFormResponses = async () => {
    if (!connectedForm) {
      const el = document.getElementById('google-forms-section');
      el?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    const activeToken = token || (await getAccessToken());
    if (!activeToken) {
      setNeedsAuth(true);
      setWorkspaceFeedback({
        type: 'error',
        text: 'Please sign in with Google to sync the latest form responses.',
      });
      return;
    }

    setIsSyncingResponses(true);
    setWorkspaceFeedback(null);
    try {
      const refreshedMeta = await fetchGoogleFormById(activeToken, connectedForm.formId);
      const updatedMeta: ConnectedGoogleForm = {
        ...refreshedMeta,
        lastSyncedAt: new Date().toISOString(),
      };
      setConnectedForm(updatedMeta);
      saveConnectedForm(updatedMeta);

      const formStudentRecords = await fetchGoogleFormResponses(
        activeToken,
        updatedMeta,
        defaultSyncClassroom
      );
      const { merged, addedCount, updatedCount } = mergeFormResponsesIntoDatabase(
        students,
        formStudentRecords,
        updatedMeta.formId
      );
      setStudents(merged);
      setWorkspaceFeedback({
        type: 'success',
        text: `Synced "${updatedMeta.title}" — ${formStudentRecords.length} total response(s) found (${addedCount} newly added, ${updatedCount} updated in database).`,
      });
    } catch (err: any) {
      if (String(err?.message || '').includes('401')) {
        setNeedsAuth(true);
      }
      setWorkspaceFeedback({
        type: 'error',
        text: err?.message || 'Could not sync responses from Google Forms.',
      });
    } finally {
      setIsSyncingResponses(false);
    }
  };

  // Request user confirmation before updating Google Form metadata via API
  const handleRequestUpdateGoogleForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectedForm) return;

    setConfirmModal({
      isOpen: true,
      title: 'Update Google Form Title & Description?',
      description: `This will modify the live Google Form "${connectedForm.title}" (ID: ${connectedForm.formId}) in your Google Workspace account with the new title "${newFormTitle.trim()}" and updated description.`,
      confirmLabel: 'Update Google Form',
      isDestructive: false,
      onConfirm: async () => {
        const activeToken = token || (await getAccessToken());
        if (!activeToken) {
          setNeedsAuth(true);
          return;
        }
        setIsUpdatingForm(true);
        try {
          const updated = await updateGoogleFormInfo(
            activeToken,
            connectedForm.formId,
            newFormTitle,
            newFormDescription
          );
          setConnectedForm(updated);
          saveConnectedForm(updated);
          setFormBuilderMode('create');
          setWorkspaceFeedback({
            type: 'success',
            text: `Updated title and description on live Google Form "${updated.title}".`,
          });
        } catch (err: any) {
          setWorkspaceFeedback({
            type: 'error',
            text: err?.message || 'Failed to update Google Form details.',
          });
        } finally {
          setIsUpdatingForm(false);
        }
      },
    });
  };

  // Direct classroom registration handler
  const handleDirectRegister = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = directName.trim();
    if (!trimmedName) return;

    const nextNumber = students.length + 1;
    const studentIdCode = `KG-26${String(nextNumber).padStart(3, '0')}`;
    const newStudent: StudentRecord = {
      id: `direct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      studentIdCode,
      fullName: trimmedName,
      gender: directGender,
      classroomGroup: directClassroom,
      source: 'Direct Entry',
      registeredAt: new Date().toISOString(),
    };

    const nextList = [newStudent, ...students];
    setStudents(nextList);
    saveStoredStudents(nextList);
    setDirectName('');
    setDirectEntryMessage(`Registered ${trimmedName} (${directGender}) under ${studentIdCode}.`);
    setTimeout(() => setDirectEntryMessage(null), 4000);
  };

  // Start editing a student row
  const handleStartEditStudent = (student: StudentRecord) => {
    setEditingStudentId(student.id);
    setEditStudentName(student.fullName);
    setEditStudentGender(student.gender);
    setEditStudentClassroom(student.classroomGroup);
  };

  // Save edited student row (with confirmation modal)
  const handleSaveEditStudent = (student: StudentRecord) => {
    const trimmed = editStudentName.trim();
    if (!trimmed) return;

    setConfirmModal({
      isOpen: true,
      title: `Update Student Record ${student.studentIdCode}?`,
      description: `Confirm updating "${student.fullName}" (${student.gender}) to "${trimmed}" (${editStudentGender}, ${editStudentClassroom}) in the kindergarten database.`,
      confirmLabel: 'Save Changes',
      isDestructive: false,
      onConfirm: () => {
        const updated = students.map((s) =>
          s.id === student.id
            ? {
                ...s,
                fullName: trimmed,
                gender: editStudentGender,
                classroomGroup: editStudentClassroom,
              }
            : s
        );
        setStudents(updated);
        saveStoredStudents(updated);
        setEditingStudentId(null);
      },
    });
  };

  // Delete a student record (with mandatory confirmation modal)
  const handleRequestDeleteStudent = (student: StudentRecord) => {
    setConfirmModal({
      isOpen: true,
      title: `Remove ${student.fullName} from Roster?`,
      description: `Are you sure you want to delete student record ${student.studentIdCode} (${student.fullName}, ${student.gender}) from the searchable kindergarten database? This action cannot be undone.`,
      confirmLabel: 'Delete Student',
      isDestructive: true,
      onConfirm: () => {
        const filtered = students.filter((s) => s.id !== student.id);
        setStudents(filtered);
        saveStoredStudents(filtered);
      },
    });
  };

  // Copy helper
  const handleCopyText = async (text: string, field: 'responder' | 'edit' | 'id') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrlField(field);
      setTimeout(() => setCopiedUrlField(null), 1800);
    } catch {
      // Fallback ignored
    }
  };

  // Toggle table column sorting
  const handleToggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'registeredAt' ? 'desc' : 'asc');
    }
  };

  // Filtered and sorted students
  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = students.filter((s) => {
      if (genderFilter !== 'ALL' && s.gender !== genderFilter) return false;
      if (sourceFilter !== 'ALL' && s.source !== sourceFilter) return false;
      if (classroomFilter !== 'ALL' && s.classroomGroup !== classroomFilter) return false;
      if (!q) return true;

      return (
        s.fullName.toLowerCase().includes(q) ||
        s.studentIdCode.toLowerCase().includes(q) ||
        s.gender.toLowerCase().includes(q) ||
        s.classroomGroup.toLowerCase().includes(q) ||
        (s.responseId && s.responseId.toLowerCase().includes(q))
      );
    });

    filtered.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'registeredAt') {
        comparison =
          new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime();
      } else if (sortField === 'fullName') {
        comparison = a.fullName.localeCompare(b.fullName);
      } else if (sortField === 'gender') {
        comparison = a.gender.localeCompare(b.gender);
      } else if (sortField === 'studentIdCode') {
        comparison = a.studentIdCode.localeCompare(b.studentIdCode);
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [students, searchQuery, genderFilter, sourceFilter, classroomFilter, sortField, sortDirection]);

  // Summary metrics
  const metrics = useMemo(() => {
    const total = students.length;
    const boys = students.filter((s) => s.gender === 'Boy').length;
    const girls = students.filter((s) => s.gender === 'Girl').length;
    const fromForms = students.filter((s) => s.source === 'Google Forms').length;
    const boysPct = total > 0 ? Math.round((boys / total) * 100) : 0;
    const girlsPct = total > 0 ? Math.round((girls / total) * 100) : 0;
    return { total, boys, girls, fromForms, boysPct, girlsPct };
  }, [students]);

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]">
      {/* Top Bar Contract: Zone 1 (Brand) — Zone 2 (4 single-line nav links) — Zone 3 (1 primary action) */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-6 py-3.5 bg-white border-b border-slate-200">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#directory-section"
          className="text-lg font-bold tracking-tight text-slate-900 font-display whitespace-nowrap shrink-0"
        >
          KinderRoster
        </a>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
          <a
            href="#directory-section"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Directory
          </a>
          <a
            href="#google-forms-section"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Google Form
          </a>
          <a
            href="#quick-register-section"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Register Student
          </a>
          <a
            href="#roster-summary-section"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Roster Summary
          </a>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          {needsAuth ? (
            <GoogleSignInButton
              onClick={handleLogin}
              disabled={isLoggingIn}
              label={isLoggingIn ? 'Signing in...' : 'Sign in with Google'}
            />
          ) : (
            <button
              type="button"
              onClick={
                connectedForm
                  ? handleSyncFormResponses
                  : () => {
                      document
                        .getElementById('google-forms-section')
                        ?.scrollIntoView({ behavior: 'smooth' });
                    }
              }
              disabled={isSyncingResponses}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isSyncingResponses ? 'animate-spin' : ''}`}
              />
              <span>
                {connectedForm
                  ? isSyncingResponses
                    ? 'Syncing Responses...'
                    : 'Sync Form Responses'
                  : 'Create Google Form'}
              </span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content Container (1440px desktop baseline) */}
      <main className="flex-1 w-full max-w-[1360px] mx-auto px-6 py-8 space-y-8">
        {/* Page Header + Account Connection Bar */}
        <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-slate-200">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <span>Kindergarten Enrolment System</span>
              <span aria-hidden="true">·</span>
              <span>Google Forms API v1</span>
              <span aria-hidden="true">·</span>
              <span>Searchable Class Roster</span>
            </div>
            <h1
              className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 font-display"
              style={{ textWrap: 'balance' }}
            >
              Kindergarten Student Registration & Searchable Database
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Generate a dedicated Google Form that collects each kindergarten student&apos;s{' '}
              <strong className="font-semibold text-slate-800">Full Name</strong> and{' '}
              <strong className="font-semibold text-slate-800">Gender</strong>, sync submitted
              responses directly from Google Forms, and search or filter the complete class roster.
            </p>
          </div>

          {/* Authenticated User Context & CSV Export */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {!needsAuth && user && (
              <div className="flex items-center gap-3 px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-600">
                <span>
                  Connected as{' '}
                  <strong className="font-semibold text-slate-900">
                    {user.email || user.displayName}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1 text-slate-500 hover:text-red-600 font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign out</span>
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => exportStudentsToCsv(filteredStudents)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
              <span>Export Roster CSV ({filteredStudents.length})</span>
            </button>
          </div>
        </section>

        {/* Feedback Banner */}
        {workspaceFeedback && (
          <div
            role="status"
            className={`flex items-center justify-between gap-4 px-4 py-3 rounded-lg border text-xs font-medium ${
              workspaceFeedback.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-800'
                : workspaceFeedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-slate-100 border-slate-200 text-slate-800'
            }`}
          >
            <span>{workspaceFeedback.text}</span>
            <button
              type="button"
              onClick={() => setWorkspaceFeedback(null)}
              className="text-current opacity-70 hover:opacity-100 cursor-pointer shrink-0"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Section 1: Roster Summary Strip (4-Column Tabular Metrics) */}
        <section
          id="roster-summary-section"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          <div className="p-5 bg-white border border-slate-200 rounded-lg">
            <div className="text-xs font-medium text-slate-500">Total Registered Students</div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {metrics.total}
              </span>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {CLASSROOM_GROUPS.length} classrooms
              </span>
            </div>
          </div>

          <div className="p-5 bg-white border border-slate-200 rounded-lg">
            <div className="text-xs font-medium text-slate-500">Girls Registered</div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {metrics.girls}
              </span>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {metrics.girlsPct}% of class
              </span>
            </div>
          </div>

          <div className="p-5 bg-white border border-slate-200 rounded-lg">
            <div className="text-xs font-medium text-slate-500">Boys Registered</div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {metrics.boys}
              </span>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {metrics.boysPct}% of class
              </span>
            </div>
          </div>

          <div className="p-5 bg-white border border-slate-200 rounded-lg">
            <div className="text-xs font-medium text-slate-500">Google Forms Submissions</div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-blue-600 font-mono tabular-nums">
                {metrics.fromForms}
              </span>
              <span className="text-xs text-slate-500">
                {connectedForm ? 'Form Linked' : 'No Form Linked'}
              </span>
            </div>
          </div>
        </section>

        {/* Section 2: Two-Column Workspace — Left: Google Forms Integration | Right: Direct Classroom Registration */}
        <section
          id="google-forms-section"
          className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch"
        >
          {/* Left Column (7 cols): Google Forms Generator, Linker & Live Response Sync */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>Google Workspace Integration</span>
                    <span aria-hidden="true">·</span>
                    <span>forms.googleapis.com</span>
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 font-display mt-0.5">
                    Google Form for Kindergarten Registration
                  </h2>
                </div>

                {/* Segmented Mode Selector */}
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setFormBuilderMode('create')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      formBuilderMode === 'create'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {connectedForm ? 'Active Form' : 'Create New Form'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormBuilderMode('connect')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      formBuilderMode === 'connect'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Link Existing Form ID
                  </button>
                  {connectedForm && (
                    <button
                      type="button"
                      onClick={() => {
                        setNewFormTitle(connectedForm.title);
                        setNewFormDescription(connectedForm.description);
                        setFormBuilderMode('edit');
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        formBuilderMode === 'edit'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Edit Form Info
                    </button>
                  )}
                </div>
              </div>

              {/* Prompt Sign-In if user hasn't signed in yet */}
              {needsAuth && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-slate-900">
                      Connect your Google Account to create or sync Google Forms
                    </div>
                    <p className="text-xs text-slate-600">
                      Sign in with Google to generate a live Kindergarten Student Name &amp; Gender
                      Google Form in your Google Drive and automatically import student responses.
                    </p>
                  </div>
                  <GoogleSignInButton
                    onClick={handleLogin}
                    disabled={isLoggingIn}
                    label={isLoggingIn ? 'Signing in...' : 'Sign in with Google'}
                  />
                </div>
              )}

              {/* Mode 1: Active Connected Form Details OR Create New Form */}
              {formBuilderMode === 'create' && (
                <>
                  {connectedForm ? (
                    <div className="space-y-5">
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="text-xs text-slate-500 flex items-center gap-2">
                              <span>Connected Google Form</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                Last synced{' '}
                                {new Date(connectedForm.lastSyncedAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            <h3 className="text-base font-bold text-slate-900 mt-0.5">
                              {connectedForm.title}
                            </h3>
                            {connectedForm.description && (
                              <p className="text-xs text-slate-600 mt-1">
                                {connectedForm.description}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <a
                              href={connectedForm.responderUri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                            >
                              <span>Open Registration Form</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                            <a
                              href={connectedForm.editUri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                            >
                              <span>Edit in Google Forms</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>

                        {/* Shareable Responder URL & Form ID */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200/80 text-xs">
                          <div className="flex items-center justify-between gap-2 bg-white px-3 py-2 rounded border border-slate-200">
                            <div className="truncate">
                              <span className="text-slate-400 mr-1.5">Responder Link:</span>
                              <span className="font-mono text-slate-700">
                                {connectedForm.responderUri}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyText(connectedForm.responderUri, 'responder')
                              }
                              className="text-slate-500 hover:text-slate-900 shrink-0 cursor-pointer"
                              title="Copy parent registration link"
                            >
                              {copiedUrlField === 'responder' ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>

                          <div className="flex items-center justify-between gap-2 bg-white px-3 py-2 rounded border border-slate-200">
                            <div className="truncate">
                              <span className="text-slate-400 mr-1.5">Form ID:</span>
                              <span className="font-mono text-slate-700">
                                {connectedForm.formId}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleCopyText(connectedForm.formId, 'id')}
                              className="text-slate-500 hover:text-slate-900 shrink-0 cursor-pointer"
                              title="Copy Form ID"
                            >
                              {copiedUrlField === 'id' ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Form Questions Schema */}
                        <div className="pt-2">
                          <div className="text-xs font-medium text-slate-500 mb-2">
                            Configured Form Questions ({connectedForm.questions.length})
                          </div>
                          <div className="divide-y divide-slate-200 border border-slate-200 rounded bg-white">
                            {connectedForm.questions.map((q, idx) => (
                              <div
                                key={q.questionId || idx}
                                className="px-3 py-2 flex items-center justify-between gap-4 text-xs"
                              >
                                <div className="font-medium text-slate-800">
                                  <span className="font-mono text-slate-400 mr-2">
                                    0{idx + 1}.
                                  </span>
                                  {q.title}
                                </div>
                                <div className="text-slate-500 flex items-center gap-1.5 shrink-0">
                                  <span>{q.type === 'TEXT' ? 'Short Text' : 'Multiple Choice'}</span>
                                  {q.options && q.options.length > 0 && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span>{q.options.join(' / ')}</span>
                                    </>
                                  )}
                                  {q.required && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span>Required</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Sync & Replace Form Controls */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleSyncFormResponses}
                            disabled={isSyncingResponses}
                            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${
                                isSyncingResponses ? 'animate-spin' : ''
                              }`}
                            />
                            <span>
                              {isSyncingResponses
                                ? 'Syncing Google Form Responses...'
                                : 'Sync Responses into Database'}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setConnectedForm(null);
                              saveConnectedForm(null);
                            }}
                            className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                          >
                            Create Another Form
                          </button>
                        </div>

                        <div className="text-xs text-slate-500">
                          New responses submitted via Google Forms sync directly into the roster
                          below.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={handleCreateGoogleForm} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                            Google Form Title
                          </label>
                          <input
                            type="text"
                            required
                            value={newFormTitle}
                            onChange={(e) => setNewFormTitle(e.target.value)}
                            placeholder="Kindergarten Class Student Registration"
                            className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                            Form Instructions / Description
                          </label>
                          <input
                            type="text"
                            value={newFormDescription}
                            onChange={(e) => setNewFormDescription(e.target.value)}
                            placeholder="Please enter the kindergarten student's full name and gender."
                            className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                            Default Classroom Assignment for Responses
                          </label>
                          <select
                            value={defaultSyncClassroom}
                            onChange={(e) => setDefaultSyncClassroom(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                          >
                            {CLASSROOM_GROUPS.map((group) => (
                              <option key={group} value={group}>
                                {group}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                            Auto-Configured Google Form Fields
                          </label>
                          <div className="px-3.5 py-2 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                            <span>01. Student Full Name (Text)</span>
                            <span aria-hidden="true">·</span>
                            <span>02. Student Gender (Boy / Girl)</span>
                          </div>
                        </div>
                      </div>

                      <div className="pt-2 flex items-center justify-between gap-4">
                        <span className="text-xs text-slate-500">
                          Creates a live Google Form in your account via Google Forms API v1.
                        </span>
                        <button
                          type="submit"
                          disabled={isCreatingForm}
                          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>
                            {isCreatingForm
                              ? 'Creating Google Form...'
                              : 'Generate Google Form'}
                          </span>
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}

              {/* Mode 2: Connect Existing Google Form by ID or URL */}
              {formBuilderMode === 'connect' && (
                <form onSubmit={handleConnectExistingForm} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Google Form ID or Editor URL
                    </label>
                    <input
                      type="text"
                      required
                      value={existingFormInput}
                      onChange={(e) => setExistingFormInput(e.target.value)}
                      placeholder="https://docs.google.com/forms/d/1abc123.../edit or Form ID"
                      className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <p className="mt-1.5 text-xs text-slate-500">
                      Paste the editor URL from your browser address bar
                      (<span className="font-mono">/forms/d/&lt;FORM_ID&gt;/edit</span>) to link
                      your existing form and import its Name &amp; Gender responses.
                    </p>
                  </div>

                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="submit"
                      disabled={isSyncingResponses}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${isSyncingResponses ? 'animate-spin' : ''}`}
                      />
                      <span>
                        {isSyncingResponses
                          ? 'Connecting & Syncing...'
                          : 'Link Form & Sync Responses'}
                      </span>
                    </button>
                  </div>
                </form>
              )}

              {/* Mode 3: Edit Connected Google Form Title & Description (Mutating API Call) */}
              {formBuilderMode === 'edit' && connectedForm && (
                <form onSubmit={handleRequestUpdateGoogleForm} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Update Google Form Title
                    </label>
                    <input
                      type="text"
                      required
                      value={newFormTitle}
                      onChange={(e) => setNewFormTitle(e.target.value)}
                      className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Update Form Description
                    </label>
                    <input
                      type="text"
                      value={newFormDescription}
                      onChange={(e) => setNewFormDescription(e.target.value)}
                      className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setFormBuilderMode('create')}
                      className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isUpdatingForm}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-60"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>
                        {isUpdatingForm ? 'Updating Form...' : 'Update Live Google Form'}
                      </span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* Right Column (5 cols): Quick Classroom Student Registration */}
          <div
            id="quick-register-section"
            className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 flex flex-col justify-between"
          >
            <div className="space-y-4">
              <div className="border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>Direct Desk Enrolment</span>
                  <span aria-hidden="true">·</span>
                  <span>Instant Database Indexing</span>
                </div>
                <h2 className="text-lg font-bold text-slate-900 font-display mt-0.5">
                  Register Kindergarten Student
                </h2>
              </div>

              <form onSubmit={handleDirectRegister} className="space-y-4">
                <div>
                  <label
                    htmlFor="student-full-name"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Student Full Name
                  </label>
                  <input
                    id="student-full-name"
                    type="text"
                    required
                    value={directName}
                    onChange={(e) => setDirectName(e.target.value)}
                    placeholder="e.g. Omar Suleiman"
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Student Gender
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {(['Girl', 'Boy'] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setDirectGender(g)}
                        className={`py-2 px-4 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                          directGender === g
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="student-classroom"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Kindergarten Classroom Section
                  </label>
                  <select
                    id="student-classroom"
                    value={directClassroom}
                    onChange={(e) => setDirectClassroom(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {CLASSROOM_GROUPS.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                </div>

                {directEntryMessage && (
                  <div className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                    {directEntryMessage}
                  </div>
                )}

                <div className="pt-1">
                  <button
                    type="submit"
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>Add Student to Searchable Database</span>
                  </button>
                </div>
              </form>
            </div>

            <div className="pt-4 mt-4 border-t border-slate-100 text-xs text-slate-500 flex items-center justify-between">
              <span>Records are immediately searchable below</span>
              <span className="font-mono tabular-nums">{students.length} total records</span>
            </div>
          </div>
        </section>

        {/* Section 3: Searchable Kindergarten Student Database */}
        <section
          id="directory-section"
          className="bg-white border border-slate-200 rounded-lg overflow-hidden"
        >
          {/* Search & Interactive Filter Controls Bar */}
          <div className="p-5 border-b border-slate-200 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 font-display">
                  Searchable Kindergarten Student Database
                </h2>
                <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                  <span className="font-mono tabular-nums">
                    Showing {filteredStudents.length} of {students.length} students
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Search by student name, ID, gender, or Google Form response ID</span>
                </div>
              </div>

              {/* Search Input */}
              <div className="relative w-full md:w-80">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search student name, ID, or gender..."
                  aria-label="Search students in kindergarten database"
                  className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Interactive Filter Controls (Segmented buttons + classroom select) */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-3">
                {/* Gender Filter Segmented Control */}
                <div
                  className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
                  role="group"
                  aria-label="Filter by student gender"
                >
                  {(['ALL', 'Girl', 'Boy'] as const).map((genderOption) => (
                    <button
                      key={genderOption}
                      type="button"
                      onClick={() => setGenderFilter(genderOption)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        genderFilter === genderOption
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {genderOption === 'ALL'
                        ? `All Genders (${students.length})`
                        : genderOption === 'Girl'
                        ? `Girls (${metrics.girls})`
                        : `Boys (${metrics.boys})`}
                    </button>
                  ))}
                </div>

                {/* Source Filter Segmented Control */}
                <div
                  className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
                  role="group"
                  aria-label="Filter by registration source"
                >
                  {(['ALL', 'Google Forms', 'Direct Entry'] as const).map((src) => (
                    <button
                      key={src}
                      type="button"
                      onClick={() => setSourceFilter(src)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        sourceFilter === src
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {src === 'ALL' ? 'All Sources' : src}
                    </button>
                  ))}
                </div>
              </div>

              {/* Classroom Filter Dropdown */}
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={classroomFilter}
                  onChange={(e) => setClassroomFilter(e.target.value)}
                  aria-label="Filter by kindergarten classroom group"
                  className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="ALL">All Classrooms</option>
                  {CLASSROOM_GROUPS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                {(searchQuery ||
                  genderFilter !== 'ALL' ||
                  sourceFilter !== 'ALL' ||
                  classroomFilter !== 'ALL') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setGenderFilter('ALL');
                      setSourceFilter('ALL');
                      setClassroomFilter('ALL');
                    }}
                    className="px-2.5 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* High-Density Data Grid */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold text-slate-500">
                  <th className="py-3 px-4 w-32">
                    <button
                      type="button"
                      onClick={() => handleToggleSort('studentIdCode')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer whitespace-nowrap"
                    >
                      <span>Student ID</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => handleToggleSort('fullName')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer whitespace-nowrap"
                    >
                      <span>Student Full Name</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4 w-32">
                    <button
                      type="button"
                      onClick={() => handleToggleSort('gender')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer whitespace-nowrap"
                    >
                      <span>Gender</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4">Classroom Section</th>
                  <th className="py-3 px-4">Registration Source</th>
                  <th className="py-3 px-4 text-right w-44">
                    <button
                      type="button"
                      onClick={() => handleToggleSort('registeredAt')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-900 cursor-pointer whitespace-nowrap ml-auto"
                    >
                      <span>Registered Date</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4 text-right w-28">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 px-6 text-center">
                      <div className="max-w-sm mx-auto space-y-2">
                        <div className="text-sm font-semibold text-slate-800">
                          No matching kindergarten student records
                        </div>
                        <p className="text-xs text-slate-500">
                          {searchQuery ||
                          genderFilter !== 'ALL' ||
                          sourceFilter !== 'ALL' ||
                          classroomFilter !== 'ALL'
                            ? 'No students matched your active search or filter criteria. Try resetting the filters.'
                            : 'Register your first student using the form above or sync responses from your connected Google Form.'}
                        </p>
                        {(searchQuery ||
                          genderFilter !== 'ALL' ||
                          sourceFilter !== 'ALL' ||
                          classroomFilter !== 'ALL') && (
                          <button
                            type="button"
                            onClick={() => {
                              setSearchQuery('');
                              setGenderFilter('ALL');
                              setSourceFilter('ALL');
                              setClassroomFilter('ALL');
                            }}
                            className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
                          >
                            Reset Search &amp; Filters
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((student) => {
                    const isEditing = editingStudentId === student.id;
                    return (
                      <tr
                        key={student.id}
                        className="hover:bg-slate-50/90 transition-colors h-11"
                      >
                        <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {student.studentIdCode}
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-slate-900">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editStudentName}
                              onChange={(e) => setEditStudentName(e.target.value)}
                              className="w-full px-2.5 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-600"
                            />
                          ) : (
                            student.fullName
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">
                          {isEditing ? (
                            <select
                              value={editStudentGender}
                              onChange={(e) =>
                                setEditStudentGender(e.target.value as 'Boy' | 'Girl')
                              }
                              className="px-2 py-1 text-xs border border-slate-300 rounded"
                            >
                              <option value="Girl">Girl</option>
                              <option value="Boy">Boy</option>
                            </select>
                          ) : (
                            /* Zero-Pill Discipline: Clean unboxed text metadata */
                            <span className="font-medium text-slate-800">{student.gender}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">
                          {isEditing ? (
                            <select
                              value={editStudentClassroom}
                              onChange={(e) => setEditStudentClassroom(e.target.value)}
                              className="px-2 py-1 text-xs border border-slate-300 rounded"
                            >
                              {CLASSROOM_GROUPS.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          ) : (
                            student.classroomGroup
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                          <span>{student.source}</span>
                          {student.responseId && (
                            <>
                              <span className="mx-1.5" aria-hidden="true">
                                ·
                              </span>
                              <span className="font-mono text-[11px] text-slate-400">
                                #{student.responseId.slice(0, 6)}
                              </span>
                            </>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                          {new Date(student.registeredAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: '2-digit',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          {isEditing ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleSaveEditStudent(student)}
                                className="px-2 py-1 text-[11px] font-semibold text-white bg-blue-600 rounded hover:bg-blue-700 cursor-pointer"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingStudentId(null)}
                                className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleStartEditStudent(student)}
                                className="p-1 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                                title={`Edit ${student.fullName}`}
                                aria-label={`Edit ${student.fullName}`}
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRequestDeleteStudent(student)}
                                className="p-1 text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                                title={`Remove ${student.fullName}`}
                                aria-label={`Remove ${student.fullName}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white px-6 py-4">
        <div className="max-w-[1360px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">KinderRoster</span>
            <span aria-hidden="true">·</span>
            <span>Kindergarten Class Name &amp; Gender Directory</span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="#google-forms-section"
              className="hover:text-slate-800 transition-colors"
            >
              Google Forms Setup
            </a>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => exportStudentsToCsv(students)}
              className="hover:text-slate-800 transition-colors cursor-pointer"
            >
              Download Full CSV
            </button>
          </div>
        </div>
      </footer>

      {/* Mandatory User Confirmation Modal for Mutating or Destructive Actions */}
      {confirmModal.isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`p-2 rounded-lg shrink-0 ${
                  confirmModal.isDestructive
                    ? 'bg-red-50 text-red-600'
                    : 'bg-blue-50 text-blue-600'
                }`}
              >
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3
                  id="confirm-dialog-title"
                  className="text-base font-bold text-slate-900 font-display"
                >
                  {confirmModal.title}
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {confirmModal.description}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() =>
                  setConfirmModal((prev) => ({
                    ...prev,
                    isOpen: false,
                  }))
                }
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const action = confirmModal.onConfirm;
                  setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                  await action();
                }}
                className={`px-4 py-2 text-xs font-semibold text-white rounded-lg transition-colors cursor-pointer ${
                  confirmModal.isDestructive
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {confirmModal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
