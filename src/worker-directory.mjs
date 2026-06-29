import { normalizeIdNumber, normalizePhone, normalizeText } from './security.mjs';

function normalizeKeyword(value) {
  return normalizeText(value).toLowerCase();
}

export function getContractorName(contractors, contractorId) {
  return contractors.find((contractor) => String(contractor.id) === String(contractorId))?.name || '未知';
}

export function getJobTitleOptions(workers) {
  return [...new Set(workers.map((worker) => normalizeText(worker.jobTitle)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

export function workerMatchesSearch(worker, contractors, search) {
  const keyword = normalizeKeyword(search);
  if (!keyword) return true;

  const contractorName = getContractorName(contractors, worker.contractorId);
  const textFields = [
    worker.name,
    worker.jobTitle,
    contractorName,
    worker.notes,
    worker.entryDate,
  ]
    .map((value) => normalizeKeyword(value))
    .filter(Boolean);

  if (textFields.some((value) => value.includes(keyword))) return true;

  const phoneKeyword = normalizePhone(search);
  if (phoneKeyword && normalizePhone(worker.phone).includes(phoneKeyword)) return true;

  const idKeyword = normalizeIdNumber(search);
  if (idKeyword && normalizeIdNumber(worker.idNumber).includes(idKeyword)) return true;

  return false;
}

function sortWorkers(workers, contractors, sortBy) {
  const list = [...workers];
  const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });
  const compareDateDesc = (left, right, key) => new Date(right?.[key] || 0).getTime() - new Date(left?.[key] || 0).getTime();
  const compareText = (left, right, mapper) => collator.compare(mapper(left), mapper(right));

  switch (sortBy) {
    case 'nameAsc':
      return list.sort((left, right) => compareText(left, right, (worker) => normalizeText(worker.name)));
    case 'contractorAsc':
      return list.sort((left, right) => compareText(left, right, (worker) => normalizeText(getContractorName(contractors, worker.contractorId)) || '未知'));
    case 'entryDateDesc':
      return list.sort((left, right) => compareDateDesc(left, right, 'entryDate'));
    case 'createdAtAsc':
      return list.sort((left, right) => new Date(left?.createdAt || 0).getTime() - new Date(right?.createdAt || 0).getTime());
    case 'createdAtDesc':
    default:
      return list.sort((left, right) => compareDateDesc(left, right, 'createdAt'));
  }
}

export function filterAndSortWorkers(workers, contractors, options = {}) {
  const {
    search = '',
    contractorId = '',
    jobTitle = '',
    sortBy = 'createdAtDesc',
  } = options;

  const normalizedJobTitle = normalizeText(jobTitle);

  const filtered = workers.filter((worker) => {
    if (contractorId && String(worker.contractorId) !== String(contractorId)) return false;
    if (normalizedJobTitle && normalizeText(worker.jobTitle) !== normalizedJobTitle) return false;
    return workerMatchesSearch(worker, contractors, search);
  });

  return sortWorkers(filtered, contractors, sortBy);
}

export function buildDuplicateWorkerMessage(duplicate, contractors) {
  if (!duplicate) return '';

  if (duplicate.type === 'idNumber') {
    return `此身分證字號已存在：${duplicate.worker?.name || '未知人員'}（${getContractorName(contractors, duplicate.worker?.contractorId)}）`;
  }

  return `同包商下已有相同姓名與手機：${duplicate.worker?.name || '未知人員'}（${getContractorName(contractors, duplicate.worker?.contractorId)}）`;
}
