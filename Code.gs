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

function requireAdmin_(secret) {
  const saved = getAdminSecret_();
  if (!saved) throw new Error('尚未建立管理者密碼');
  if (String(secret || '') !== saved) throw new Error('管理者驗證失敗');
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

/* ── getData ──────────────────────────────────────────────── */

function getData() {
  const ss = getDb();
  return {
    contractors: readSheet(ss.getSheetByName('包商')),
    workers:     readSheet(ss.getSheetByName('人員'))
  };
}

/* ── Contractors ──────────────────────────────────────────── */

function addContractor(p) {
  requireAdmin_(p._adminSecret);
  const ss = getDb();
  ss.getSheetByName('包商').appendRow([p.id, p.name, p.createdAt]);
  // 建立資料夾 + 名冊 Sheet
  getContractorFolder(p.name);
  ensureContractorSheet(p.name);
  return { ok: true };
}

function deleteContractor(p) {
  requireAdmin_(p._adminSecret);
  deleteRowById(getDb().getSheetByName('包商'), p.id);
  return { ok: true };
}

/* ── Workers ──────────────────────────────────────────────── */

function addWorker(p) {
  const ss = getDb();

  // 查詢包商名稱
  const contractors = readSheet(ss.getSheetByName('包商'));
  const co = contractors.find(c => c.id === String(p.contractorId)) || {};
  const coName = co.name || '';

  // 儲存照片至 Drive
  let photoUrl = '';
  if (p.photo) photoUrl = savePhotoToDrive(p, coName);

  // 寫入主資料庫
  ss.getSheetByName('人員').appendRow([
    p.id, p.name, p.idNumber || '', p.phone || '',
    p.jobTitle, p.contractorId, coName,
    p.entryDate || '', p.notes || '',
    photoUrl, p.createdAt
  ]);

  // 寫入各包商獨立名冊
  if (coName) appendWorkerToContractorSheet(coName, p, photoUrl);

  return { ok: true, photoUrl };
}

function deleteWorker(p) {
  requireAdmin_(p._adminSecret);
  deleteRowById(getDb().getSheetByName('人員'), p.id);
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
