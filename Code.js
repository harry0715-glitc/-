// ═══════════════════════════════════════════════════════════════
//  施工人員名冊系統 — Google Apps Script 後端
//  貼到 script.google.com → 部署為網路應用程式
// ═══════════════════════════════════════════════════════════════

const ROOT_FOLDER = '施工人員名冊';
const DB_FILE     = '📋 系統資料庫';
const ADMIN_USERNAME = 'admin';
const ADMIN_SECRET_KEY = 'WR_ADMIN_SECRET';

/* ── Entry Points ─────────────────────────────────────────── */

function doPost(e) {
  try {
    const { action, payload = {} } = JSON.parse(e.postData.contents);
    return respond({ ok: true, data: run(action, payload) });
  } catch (err) {
    return respond({ ok: false, error: err.message });
  }
}

function doGet(e) {
  try {
    const action = (e.parameter && e.parameter.action) || 'getData';
    return respond({ ok: true, data: run(action, {}) });
  } catch (err) {
    return respond({ ok: false, error: err.message });
  }
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function run(action, p) {
  switch (action) {
    case 'getData':            return getData();
    case 'adminStatus':        return adminStatus();
    case 'authenticateAdmin':  return authenticateAdmin(p);
    case 'bootstrapAdmin':     return bootstrapAdmin(p);
    case 'changeAdminSecret':  return changeAdminSecret(p);
    case 'addContractor':      return addContractor(p);
    case 'deleteContractor':   return deleteContractor(p);
    case 'addWorker':          return addWorker(p);
    case 'deleteWorker':       return deleteWorker(p);
    default: throw new Error('Unknown action: ' + action);
  }
}

/* ── Admin Auth ───────────────────────────────────────────── */

function getAdminSecret_() {
  return PropertiesService.getScriptProperties().getProperty(ADMIN_SECRET_KEY) || '';
}

function normalizeAdminUsername_(value) {
  return String(value || '').trim().toLowerCase();
}

function validateAdminSecret_(value) {
  return String(value || '').length >= 6;
}

function normalizeText_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeIdNumber_(value) {
  return normalizeText_(value).toUpperCase().replace(/\s+/g, '');
}

function normalizePhone_(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 10);
}

function normalizeNotes_(value) {
  return normalizeText_(value);
}

function validateIdNumber_(value) {
  return !value || /^[A-Z][0-9]{9}$/.test(value);
}

function validatePhone_(value) {
  return !value || /^09\d{8}$/.test(value);
}

function requireAdmin_(secret) {
  const saved = getAdminSecret_();
  if (!saved) throw new Error('尚未建立管理者密碼');
  if (String(secret || '') !== saved) throw new Error('管理者驗證失敗');
}

function hasAdminAccess_(secret) {
  const saved = getAdminSecret_();
  return Boolean(saved) && String(secret || '') === saved;
}

function adminStatus() {
  return {
    bootstrapped: Boolean(getAdminSecret_()),
    username: ADMIN_USERNAME
  };
}

function authenticateAdmin(p) {
  if (normalizeAdminUsername_(p.username) !== ADMIN_USERNAME) throw new Error('管理者帳號錯誤');
  requireAdmin_(p.secret);
  return { authenticated: true, username: ADMIN_USERNAME };
}

function bootstrapAdmin(p) {
  if (getAdminSecret_()) throw new Error('管理者密碼已設定');
  if (normalizeAdminUsername_(p.username) !== ADMIN_USERNAME) throw new Error('管理者帳號固定為 admin');
  if (!validateAdminSecret_(p.secret)) throw new Error('管理密碼至少 6 碼');
  PropertiesService.getScriptProperties().setProperty(ADMIN_SECRET_KEY, String(p.secret));
  return { bootstrapped: true, username: ADMIN_USERNAME };
}

function changeAdminSecret(p) {
  requireAdmin_(p.currentSecret || p._adminSecret);
  if (!validateAdminSecret_(p.newSecret)) throw new Error('管理密碼至少 6 碼');
  PropertiesService.getScriptProperties().setProperty(ADMIN_SECRET_KEY, String(p.newSecret));
  return { ok: true };
}

/* ── Drive Helpers ────────────────────────────────────────── */

function getRootFolder() {
  const it = DriveApp.getFoldersByName(ROOT_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_FOLDER);
}

function getContractorFolder(name) {
  const root = getRootFolder();
  const it = root.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  const f = root.createFolder(name);
  f.createFolder('照片');
  return f;
}

function moveToFolder(fileId, folder) {
  const file = DriveApp.getFileById(fileId);
  folder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
}

/* ── Database (Master Spreadsheet) ───────────────────────── */

let _dbCache = null;

function getDb() {
  if (_dbCache) return _dbCache;
  const root = getRootFolder();
  const it = root.getFilesByName(DB_FILE);
  if (it.hasNext()) {
    _dbCache = SpreadsheetApp.open(it.next());
    return _dbCache;
  }

  // 初次建立資料庫
  const ss = SpreadsheetApp.create(DB_FILE);

  const s1 = ss.getActiveSheet().setName('包商');
  s1.appendRow(['id', 'name', 'createdAt']);
  applyHeaderStyle(s1, 3);

  const s2 = ss.insertSheet('人員');
  s2.appendRow(['id', 'name', 'idNumber', 'phone', 'jobTitle',
                'contractorId', 'contractorName', 'entryDate',
                'notes', 'photoUrl', 'createdAt']);
  applyHeaderStyle(s2, 11);

  moveToFolder(ss.getId(), root);
  _dbCache = ss;
  return _dbCache;
}

function applyHeaderStyle(sheet, cols) {
  const r = sheet.getRange(1, 1, 1, cols);
  r.setBackground('#BF360C')
   .setFontColor('#FFFFFF')
   .setFontWeight('bold')
   .setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
}

function readSheet(sheet) {
  const vals = sheet.getDataRange().getValues();
  if (vals.length < 2) return [];
  const headers = vals[0];
  return vals.slice(1)
    .filter(row => row[0] !== '' && row[0] !== null && row[0] !== undefined)
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (row[i] == null) ? '' : String(row[i]); });
      return obj;
    });
}

function deleteRowById(sheet, id) {
  const vals = sheet.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

function findContractorById_(contractors, contractorId) {
  return contractors.find(c => String(c.id) === String(contractorId)) || null;
}

function findDuplicateContractorByName_(contractors, name) {
  const target = normalizeText_(name).toLowerCase();
  if (!target) return null;
  return contractors.find(c => normalizeText_(c.name).toLowerCase() === target) || null;
}

function findDuplicateWorker_(workers, payload) {
  const idNumber = normalizeIdNumber_(payload.idNumber);
  if (idNumber) {
    const idMatch = workers.find(worker => normalizeIdNumber_(worker.idNumber) === idNumber);
    if (idMatch) return { type: 'idNumber', worker: idMatch };
  }

  const contractorId = String(payload.contractorId || '').trim();
  const name = normalizeText_(payload.name).toLowerCase();
  const phone = normalizePhone_(payload.phone);
  if (!contractorId || !name || !phone) return null;

  const profileMatch = workers.find(worker => {
    if (String(worker.contractorId || '').trim() !== contractorId) return false;
    if (normalizeText_(worker.name).toLowerCase() !== name) return false;
    return normalizePhone_(worker.phone) === phone;
  });

  return profileMatch ? { type: 'profile', worker: profileMatch } : null;
}

function maskIdNumber_(value) {
  const text = normalizeIdNumber_(value);
  if (!text) return '';
  if (text.length <= 4) return Array(text.length + 1).join('*');
  return text.slice(0, 1) + text.slice(1, -2).replace(/./g, '*') + text.slice(-2);
}

function maskPhone_(value) {
  const digits = normalizePhone_(value);
  if (!digits) return '';
  if (digits.length < 7) return String(value || '').replace(/.(?=..)/g, '*');
  return digits.slice(0, 2) + '** *** ' + digits.slice(-3);
}

function sanitizeWorkerForPublic_(worker) {
  return Object.assign({}, worker, {
    idNumber: worker.idNumber ? maskIdNumber_(worker.idNumber) : '',
    phone: worker.phone ? maskPhone_(worker.phone) : ''
  });
}

function buildContractorSheetWorkerMatcher_(worker) {
  const expected = [
    normalizeText_(worker.name),
    normalizeIdNumber_(worker.idNumber),
    normalizePhone_(worker.phone),
    normalizeText_(worker.jobTitle),
    normalizeText_(worker.entryDate),
    normalizeNotes_(worker.notes),
    worker.createdAt ? normalizeText_(new Date(worker.createdAt).toLocaleString('zh-TW')) : ''
  ];

  return function(row) {
    const actual = [
      normalizeText_(row[1]),
      normalizeIdNumber_(row[2]),
      normalizePhone_(row[3]),
      normalizeText_(row[4]),
      normalizeText_(row[5]),
      normalizeNotes_(row[6]),
      normalizeText_(row[7])
    ];
    return expected.every(function(value, index) {
      return actual[index] === value;
    });
  };
}

function deleteFirstMatchingDataRow_(sheet, predicate) {
  const vals = sheet.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (predicate(vals[i], i + 1)) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

function sanitizeContractorPayload_(p, contractors) {
  const name = normalizeText_(p.name);
  if (!name) throw new Error('請輸入包商名稱');
  if (name.length > 60) throw new Error('包商名稱過長');
  if (findDuplicateContractorByName_(contractors, name)) throw new Error('已有相同名稱的包商');

  return {
    id: String(p.id || Date.now()),
    name,
    createdAt: p.createdAt || new Date().toISOString()
  };
}

function sanitizeWorkerPayload_(p, contractors, workers) {
  const name = normalizeText_(p.name);
  const jobTitle = normalizeText_(p.jobTitle);
  const contractorId = String(p.contractorId || '').trim();
  const idNumber = normalizeIdNumber_(p.idNumber);
  const phone = normalizePhone_(p.phone);
  const notes = normalizeNotes_(p.notes);
  const entryDate = normalizeText_(p.entryDate);

  if (!name) throw new Error('請填寫姓名');
  if (!jobTitle) throw new Error('請填寫工作職稱');
  if (!contractorId) throw new Error('請選擇所屬包商');
  if (name.length > 30) throw new Error('姓名過長');
  if (jobTitle.length > 30) throw new Error('工作職稱過長');
  if (notes.length > 200) throw new Error('備註請限制在 200 字內');
  if (!validateIdNumber_(idNumber)) throw new Error('身分證字號格式不正確');
  if (!validatePhone_(phone)) throw new Error('手機號碼格式不正確');

  const contractor = findContractorById_(contractors, contractorId);
  if (!contractor) throw new Error('找不到所屬包商');

  const duplicate = findDuplicateWorker_(workers, { name, contractorId, idNumber, phone });
  if (duplicate) {
    throw new Error(duplicate.type === 'idNumber'
      ? '此身分證字號已存在，請確認是否重複登記'
      : '同包商下已有相同姓名與手機的人員資料');
  }

  return {
    id: String(p.id || Date.now()),
    name,
    idNumber,
    phone,
    jobTitle,
    contractorId,
    contractorName: contractor.name,
    entryDate,
    notes,
    photo: p.photo || '',
    createdAt: p.createdAt || new Date().toISOString()
  };
}

/* ── getData ──────────────────────────────────────────────── */

function getData(p) {
  const ss = getDb();
  const contractors = readSheet(ss.getSheetByName('包商'));
  const workers = readSheet(ss.getSheetByName('人員'));
  const canViewSensitive = hasAdminAccess_(p && p._adminSecret);
  return {
    contractors: contractors,
    workers: canViewSensitive ? workers : workers.map(sanitizeWorkerForPublic_)
  };
}

/* ── Contractors ──────────────────────────────────────────── */

function addContractor(p) {
  requireAdmin_(p._adminSecret);
  const ss = getDb();
  const contractorsSheet = ss.getSheetByName('包商');
  const contractors = readSheet(contractorsSheet);
  const payload = sanitizeContractorPayload_(p, contractors);

  contractorsSheet.appendRow([payload.id, payload.name, payload.createdAt]);
  // 建立資料夾 + 名冊 Sheet
  getContractorFolder(payload.name);
  ensureContractorSheet(payload.name);
  return { ok: true, contractor: payload };
}

function deleteContractor(p) {
  requireAdmin_(p._adminSecret);
  const ss = getDb();
  const contractorsSheet = ss.getSheetByName('包商');
  const contractors = readSheet(contractorsSheet);
  const contractor = findContractorById_(contractors, p.id);
  if (!contractor) throw new Error('找不到要刪除的包商');

  const workers = readSheet(ss.getSheetByName('人員')).filter(worker => String(worker.contractorId) === String(p.id));
  if (workers.length > 0) throw new Error(`此包商底下仍有 ${workers.length} 筆人員資料，請先刪除人員資料`);

  deleteRowById(contractorsSheet, p.id);
  return { ok: true };
}

/* ── Workers ──────────────────────────────────────────────── */

function addWorker(p) {
  const ss = getDb();
  const contractors = readSheet(ss.getSheetByName('包商'));
  const workersSheet = ss.getSheetByName('人員');
  const workers = readSheet(workersSheet);
  const payload = sanitizeWorkerPayload_(p, contractors, workers);

  // 儲存照片至 Drive
  let photoUrl = '';
  if (payload.photo) photoUrl = savePhotoToDrive(payload, payload.contractorName);

  // 寫入主資料庫
  workersSheet.appendRow([
    payload.id, payload.name, payload.idNumber || '', payload.phone || '',
    payload.jobTitle, payload.contractorId, payload.contractorName,
    payload.entryDate || '', payload.notes || '',
    photoUrl, payload.createdAt
  ]);

  // 寫入各包商獨立名冊
  appendWorkerToContractorSheet(payload.contractorName, payload, photoUrl);

  return { ok: true, photoUrl };
}

function deleteWorker(p) {
  requireAdmin_(p._adminSecret);
  const ss = getDb();
  const workersSheet = ss.getSheetByName('人員');
  const workers = readSheet(workersSheet);
  const worker = workers.find(item => String(item.id) === String(p.id));
  if (!worker) throw new Error('找不到要刪除的人員資料');

  deleteRowById(workersSheet, p.id);
  deleteWorkerFromContractorSheet_(worker.contractorName, worker);
  return { ok: true };
}

/* ── Photo ────────────────────────────────────────────────── */

function savePhotoToDrive(worker, coName) {
  try {
    const folder = getContractorFolder(coName || ROOT_FOLDER);
    const pFolders = folder.getFoldersByName('照片');
    const pFolder = pFolders.hasNext() ? pFolders.next() : folder.createFolder('照片');

    // 解析 base64
    const b64 = worker.photo.replace(/^data:image\/[a-z+]+;base64,/, '');
    const blob = Utilities.newBlob(
      Utilities.base64Decode(b64),
      'image/jpeg',
      worker.name + '_' + worker.id + '.jpg'
    );

    const file = pFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // 回傳可嵌入圖片的縮圖網址
    return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w480';
  } catch (err) {
    console.error('savePhotoToDrive error:', err);
    return '';
  }
}

/* ── Per-Contractor Sheet ─────────────────────────────────── */

function ensureContractorSheet(coName) {
  const folder = getContractorFolder(coName);
  const sheetName = coName + ' 人員名冊';
  const it = folder.getFilesByName(sheetName);
  if (it.hasNext()) return SpreadsheetApp.open(it.next());

  const ss = SpreadsheetApp.create(sheetName);
  const sheet = ss.getActiveSheet().setName('名冊');
  const headers = ['編號', '姓名', '身分證字號', '手機', '職稱', '進場日期', '備註', '登記時間'];
  sheet.appendRow(headers);
  applyHeaderStyle(sheet, headers.length);
  sheet.setColumnWidth(2, 80);
  sheet.setColumnWidth(5, 120);

  moveToFolder(ss.getId(), folder);
  return ss;
}

function appendWorkerToContractorSheet(coName, worker, photoUrl) {
  try {
    const ss = ensureContractorSheet(coName);
    const sheet = ss.getSheetByName('名冊') || ss.getSheets()[0];
    const rowNum = sheet.getLastRow(); // (不含標題)
    sheet.appendRow([
      rowNum,
      worker.name,
      worker.idNumber || '',
      worker.phone || '',
      worker.jobTitle,
      worker.entryDate || '',
      worker.notes || '',
      new Date(worker.createdAt).toLocaleString('zh-TW')
    ]);
    sheet.autoResizeColumns(1, 8);
  } catch (err) {
    console.error('appendWorkerToContractorSheet error:', err);
  }
}

function deleteWorkerFromContractorSheet_(coName, worker) {
  try {
    const ss = ensureContractorSheet(coName);
    const sheet = ss.getSheetByName('名冊') || ss.getSheets()[0];
    const matcher = buildContractorSheetWorkerMatcher_(worker);
    deleteFirstMatchingDataRow_(sheet, matcher);
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return;
    const values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
    for (let i = 0; i < values.length; i++) {
      values[i][0] = i + 1;
    }
    sheet.getRange(2, 1, values.length, 8).setValues(values);
  } catch (err) {
    console.error('deleteWorkerFromContractorSheet error:', err);
  }
}
