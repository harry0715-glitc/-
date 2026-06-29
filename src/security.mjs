export const ADMIN_USERNAME = 'admin';
export const MIN_ADMIN_SECRET_LENGTH = 6;

export function normalizeText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function normalizeAdminUsername(value = '') {
  return normalizeText(value).toLowerCase();
}

export function isFixedAdminUsername(value = '') {
  return normalizeAdminUsername(value) === ADMIN_USERNAME;
}

export function validateAdminSecret(value = '') {
  return String(value).length >= MIN_ADMIN_SECRET_LENGTH;
}

export function normalizeIdNumber(value = '') {
  return normalizeText(value).toUpperCase().replace(/\s+/g, '');
}

export function normalizePhone(value = '') {
  return String(value || '').replace(/\D/g, '').slice(0, 10);
}

export function normalizeNotes(value = '') {
  return normalizeText(value);
}

export function findDuplicateContractor(contractors = [], name = '') {
  const target = normalizeText(name).toLowerCase();
  if (!target) return null;
  return contractors.find((contractor) => normalizeText(contractor?.name).toLowerCase() === target) || null;
}

export function findDuplicateWorker(workers = [], worker = {}) {
  const idNumber = normalizeIdNumber(worker.idNumber);
  if (idNumber) {
    const idMatch = workers.find((item) => normalizeIdNumber(item?.idNumber) === idNumber);
    if (idMatch) return { type: 'idNumber', worker: idMatch };
  }

  const contractorId = String(worker.contractorId || '').trim();
  const name = normalizeText(worker.name).toLowerCase();
  const phone = normalizePhone(worker.phone);
  if (!contractorId || !name) return null;

  const profileMatch = workers.find((item) => {
    if (String(item?.contractorId || '').trim() !== contractorId) return false;
    if (normalizeText(item?.name).toLowerCase() !== name) return false;
    return phone ? normalizePhone(item?.phone) === phone : false;
  });

  return profileMatch ? { type: 'profile', worker: profileMatch } : null;
}

export function maskIdNumber(value = '') {
  const text = normalizeIdNumber(value);
  if (!text) return '';
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 1)}${text.slice(1, -2).replace(/./g, '*')}${text.slice(-2)}`;
}

export function maskPhone(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  const digits = normalizePhone(text);
  if (digits.length < 7) return text.replace(/.(?=..)/g, '*');
  return `${digits.slice(0, 2)}** *** ${digits.slice(-3)}`;
}

export function sanitizeWorkerForPublic(worker = {}) {
  return {
    ...worker,
    idNumber: worker?.idNumber ? maskIdNumber(worker.idNumber) : '',
    phone: worker?.phone ? normalizePhone(worker.phone) : '',
  };
}

export function sanitizeWorkersForPublic(workers = []) {
  return workers.map((worker) => sanitizeWorkerForPublic(worker));
}

export function buildContractorSheetWorkerMatcher(worker = {}) {
  const expected = [
    normalizeText(worker.name),
    normalizeIdNumber(worker.idNumber),
    normalizePhone(worker.phone),
    normalizeText(worker.jobTitle),
    normalizeText(worker.entryDate),
    normalizeNotes(worker.notes),
    worker.createdAt ? normalizeText(new Date(worker.createdAt).toLocaleString('zh-TW')) : '',
  ];

  return (row = []) => {
    const actual = [
      normalizeText(row[1]),
      normalizeIdNumber(row[2]),
      normalizePhone(row[3]),
      normalizeText(row[4]),
      normalizeText(row[5]),
      normalizeNotes(row[6]),
      normalizeText(row[7]),
    ];
    return expected.every((value, index) => actual[index] === value);
  };
}
