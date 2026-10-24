export interface StudentRecord {
  id: string;
  studentIdCode: string;
  fullName: string;
  gender: 'Boy' | 'Girl';
  classroomGroup: string;
  source: 'Google Forms' | 'Direct Entry';
  responseId?: string;
  formId?: string;
  registeredAt: string;
}

export interface GoogleFormQuestionInfo {
  itemId: string;
  questionId: string;
  title: string;
  type: 'TEXT' | 'CHOICE' | 'OTHER';
  options?: string[];
  required: boolean;
}

export interface ConnectedGoogleForm {
  formId: string;
  title: string;
  description: string;
  responderUri: string;
  editUri: string;
  questions: GoogleFormQuestionInfo[];
  lastSyncedAt: string;
}

export interface CreateFormOptions {
  title: string;
  description: string;
  classroomGroup: string;
  genderLabels: [string, string];
}

/**
 * Extracts a clean Google Form ID from either a raw ID string or a full Google Forms edit URL.
 */
export function extractFormId(rawInput: string): { formId: string; isResponderUrlError: boolean } {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { formId: '', isResponderUrlError: false };
  }

  // Detect if user pasted a public /forms/d/e/ responder link instead of the editor Form ID
  if (trimmed.includes('/forms/d/e/')) {
    return { formId: '', isResponderUrlError: true };
  }

  const urlMatch = trimmed.match(/\/forms\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch && urlMatch[1]) {
    return { formId: urlMatch[1], isResponderUrlError: false };
  }

  return { formId: trimmed, isResponderUrlError: false };
}

/**
 * Parses a raw Google Form API v1 response into our structured ConnectedGoogleForm model.
 */
export function parseGoogleFormMetadata(rawForm: any): ConnectedGoogleForm {
  const formId: string = rawForm.formId || '';
  const title: string = rawForm.info?.title || rawForm.info?.documentTitle || 'Kindergarten Registration Form';
  const description: string = rawForm.info?.description || '';
  const responderUri: string =
    rawForm.responderUri || `https://docs.google.com/forms/d/${encodeURIComponent(formId)}/viewform`;
  const editUri = `https://docs.google.com/forms/d/${encodeURIComponent(formId)}/edit`;

  const questions: GoogleFormQuestionInfo[] = [];
  if (Array.isArray(rawForm.items)) {
    for (const item of rawForm.items) {
      const q = item.questionItem?.question;
      if (q && q.questionId) {
        let type: 'TEXT' | 'CHOICE' | 'OTHER' = 'OTHER';
        let options: string[] | undefined;

        if (q.textQuestion) {
          type = 'TEXT';
        } else if (q.choiceQuestion) {
          type = 'CHOICE';
          options = Array.isArray(q.choiceQuestion.options)
            ? q.choiceQuestion.options.map((o: any) => String(o.value || ''))
            : [];
        }

        questions.push({
          itemId: item.itemId || '',
          questionId: q.questionId,
          title: item.title || 'Untitled Question',
          type,
          options,
          required: Boolean(q.required),
        });
      }
    }
  }

  return {
    formId,
    title,
    description,
    responderUri,
    editUri,
    questions,
    lastSyncedAt: new Date().toISOString(),
  };
}

/**
 * Creates a new Google Form specifically tailored for Kindergarten Student Name & Gender registration.
 * Uses the 2-step Google Forms v1 API protocol:
 * 1) POST /v1/forms with info.title
 * 2) POST /v1/forms/{formId}:batchUpdate to add description and the Name + Gender questions
 */
export async function createKindergartenGoogleForm(
  accessToken: string,
  options: CreateFormOptions
): Promise<ConnectedGoogleForm> {
  const createRes = await fetch('https://forms.googleapis.com/v1/forms', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      info: {
        title: options.title.trim() || 'Kindergarten Student Registration',
        documentTitle: options.title.trim() || 'Kindergarten Student Registration',
      },
    }),
  });

  if (!createRes.ok) {
    const errBody = await createRes.json().catch(() => ({}));
    throw new Error(
      errBody?.error?.message || `Failed to create Google Form (HTTP ${createRes.status}).`
    );
  }

  const createdForm = await createRes.json();
  const safeFormId = encodeURIComponent((createdForm.formId || '').trim());

  const batchUpdatePayload = {
    includeFormInResponse: true,
    requests: [
      {
        updateFormInfo: {
          info: {
            description:
              options.description.trim() ||
              'Kindergarten class student roster registration. Please enter the student full name and select gender.',
          },
          updateMask: 'description',
        },
      },
      {
        createItem: {
          item: {
            title: 'Student Full Name',
            description: "Enter the kindergarten student's first and last name.",
            questionItem: {
              question: {
                required: true,
                textQuestion: {
                  paragraph: false,
                },
              },
            },
          },
          location: {
            index: 0,
          },
        },
      },
      {
        createItem: {
          item: {
            title: 'Student Gender',
            description: "Select the student's gender for the kindergarten class database.",
            questionItem: {
              question: {
                required: true,
                choiceQuestion: {
                  type: 'RADIO',
                  options: [
                    { value: options.genderLabels[0] || 'Boy' },
                    { value: options.genderLabels[1] || 'Girl' },
                  ],
                  shuffle: false,
                },
              },
            },
          },
          location: {
            index: 1,
          },
        },
      },
    ],
  };

  const batchRes = await fetch(
    `https://forms.googleapis.com/v1/forms/${safeFormId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batchUpdatePayload),
    }
  );

  if (!batchRes.ok) {
    const errBody = await batchRes.json().catch(() => ({}));
    throw new Error(
      errBody?.error?.message ||
        `Created form but failed to add Name and Gender fields (HTTP ${batchRes.status}).`
    );
  }

  const batchData = await batchRes.json();
  const updatedForm = batchData.form || createdForm;
  return parseGoogleFormMetadata(updatedForm);
}

/**
 * Fetches an existing Google Form by Form ID.
 */
export async function fetchGoogleFormById(
  accessToken: string,
  formId: string
): Promise<ConnectedGoogleForm> {
  const safeFormId = encodeURIComponent(formId.trim());
  const res = await fetch(`https://forms.googleapis.com/v1/forms/${safeFormId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(
      errBody?.error?.message || `Could not fetch Google Form (HTTP ${res.status}).`
    );
  }

  const data = await res.json();
  return parseGoogleFormMetadata(data);
}

/**
 * Updates the title and description of an existing Google Form (mutating operation).
 */
export async function updateGoogleFormInfo(
  accessToken: string,
  formId: string,
  title: string,
  description: string
): Promise<ConnectedGoogleForm> {
  const safeFormId = encodeURIComponent(formId.trim());
  const res = await fetch(`https://forms.googleapis.com/v1/forms/${safeFormId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      includeFormInResponse: true,
      requests: [
        {
          updateFormInfo: {
            info: {
              title: title.trim(),
              description: description.trim(),
            },
            updateMask: 'title,description',
          },
        },
      ],
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(
      errBody?.error?.message || `Failed to update Google Form info (HTTP ${res.status}).`
    );
  }

  const data = await res.json();
  return parseGoogleFormMetadata(data.form);
}

/**
 * Normalizes a raw gender answer string from Google Forms into 'Boy' | 'Girl'.
 */
function normalizeGenderValue(raw: string): 'Boy' | 'Girl' | null {
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return null;
  if (
    cleaned === 'boy' ||
    cleaned === 'male' ||
    cleaned === 'm' ||
    cleaned.startsWith('boy') ||
    cleaned.startsWith('male')
  ) {
    return 'Boy';
  }
  if (
    cleaned === 'girl' ||
    cleaned === 'female' ||
    cleaned === 'f' ||
    cleaned.startsWith('girl') ||
    cleaned.startsWith('female')
  ) {
    return 'Girl';
  }
  return null;
}

/**
 * Fetches all responses from a Google Form and transforms them into StudentRecord items.
 */
export async function fetchGoogleFormResponses(
  accessToken: string,
  formMeta: ConnectedGoogleForm,
  defaultClassroomGroup: string
): Promise<StudentRecord[]> {
  const safeFormId = encodeURIComponent(formMeta.formId.trim());
  const res = await fetch(`https://forms.googleapis.com/v1/forms/${safeFormId}/responses`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(
      errBody?.error?.message || `Could not read Google Form responses (HTTP ${res.status}).`
    );
  }

  const data = await res.json();
  const rawResponses: any[] = Array.isArray(data.responses) ? data.responses : [];

  // Identify which questionId corresponds to Name and which corresponds to Gender
  const nameQuestion =
    formMeta.questions.find((q) => /name|student|child|pupil/i.test(q.title) && !/gender|sex/i.test(q.title)) ||
    formMeta.questions.find((q) => q.type === 'TEXT') ||
    formMeta.questions[0];

  const genderQuestion =
    formMeta.questions.find((q) => /gender|sex|boy|girl/i.test(q.title)) ||
    formMeta.questions.find((q) => q.type === 'CHOICE') ||
    formMeta.questions[1];

  const parsedRecords: StudentRecord[] = [];

  rawResponses.forEach((resp, idx) => {
    const responseId: string = resp.responseId || `resp-${idx + 1}`;
    const submittedAt: string = resp.lastSubmittedTime || resp.createTime || new Date().toISOString();
    const answersObj: Record<string, any> = resp.answers || {};

    let extractedName = '';
    let extractedGender: 'Boy' | 'Girl' | null = null;

    if (nameQuestion && answersObj[nameQuestion.questionId]) {
      const val =
        answersObj[nameQuestion.questionId]?.textAnswers?.answers?.[0]?.value || '';
      extractedName = String(val).trim();
    }

    if (genderQuestion && answersObj[genderQuestion.questionId]) {
      const val =
        answersObj[genderQuestion.questionId]?.textAnswers?.answers?.[0]?.value || '';
      extractedGender = normalizeGenderValue(String(val));
    }

    // Fallback: inspect all answers if either name or gender wasn't matched by questionId
    for (const ansKey of Object.keys(answersObj)) {
      const val = String(answersObj[ansKey]?.textAnswers?.answers?.[0]?.value || '').trim();
      if (!val) continue;
      const maybeGender = normalizeGenderValue(val);
      if (maybeGender && !extractedGender) {
        extractedGender = maybeGender;
      } else if (!maybeGender && !extractedName) {
        extractedName = val;
      }
    }

    if (extractedName) {
      const shortCode = responseId.replace(/[^a-zA-Z0-9]/g, '').slice(-5).toUpperCase();
      parsedRecords.push({
        id: `gf-${formMeta.formId}-${responseId}`,
        studentIdCode: `KG-F${shortCode.padStart(5, '0')}`,
        fullName: extractedName,
        gender: extractedGender || 'Girl',
        classroomGroup: defaultClassroomGroup,
        source: 'Google Forms',
        responseId,
        formId: formMeta.formId,
        registeredAt: submittedAt,
      });
    }
  });

  // Sort newest first
  parsedRecords.sort(
    (a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime()
  );

  return parsedRecords;
}
