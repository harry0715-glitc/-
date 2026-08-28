// 施工人員名冊系統 - Google Apps Script 後端
// 公開端只可取得承包商清單與送出登錄；所有管理操作都必須經 Netlify Function。

const ROOT_FOLDER_NAME = '施工人員名冊';
const DB_FILE_NAME = '📋 系統資料庫';
const REPORT_FOLDER_NAME = '📑 匯出報表';
const BACKUP_FOLDER_NAME = '🔒 每日備份';
const SCHEMA_VERSION = '6';
const CONTRACTOR_TYPE_PRIMARY = 'primary';
const CONTRACTOR_TYPE_SUBCONTRACTOR = 'subcontractor';
const PUBLIC_CONFIG_CACHE_KEY = 'workers_registry_public_config_v1';
const PUBLIC_CONFIG_PROPERTY_KEY = 'PUBLIC_CONFIG_SNAPSHOT_V1';
const PUBLIC_CONFIG_CACHE_SECONDS = 300;
const REPORT_MIN_FONT_SIZE = 12;
const REPORT_PHOTO_WIDTH_PT = 108;
const REPORT_PHOTO_HEIGHT_PT = 139;
const TAIWAN_ID_AREA_CODES = {
  A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17,
  I: 34, J: 18, K: 19, L: 20, M: 21, N: 22, O: 35, P: 23,
  Q: 24, R: 25, S: 26, T: 27, U: 28, V: 29, W: 32, X: 30,
  Y: 31, Z: 33
};

const CONTRACTOR_HEADERS = ['id', 'name', 'companyType', 'createdAt', 'status', 'archivedAt'];
const WORKER_HEADERS = [
  'id', 'name', 'idNumber', 'phone', 'emergencyContact', 'emergencyPhone',
  'bloodType', 'jobTitle', 'contractorId', 'contractorName', 'entryDate',
  'notes', 'photoUrl', 'createdAt', 'photoFileId', 'status', 'deletedAt',
  'updatedAt', 'submissionId', 'consentedAt', 'source', 'createdById',
  'createdByName'
];
const MANAGER_HEADERS = [
  'id', 'username', 'displayName', 'email', 'role', 'contractorId',
  'contractorName', 'passwordSalt', 'passwordHash', 'status',
  'mustChangePassword', 'sessionVersion', 'failedAttempts', 'lockedUntil', 'createdAt',
  'updatedAt', 'lastLoginAt'
];
const AUDIT_HEADERS = [
  'timestamp', 'actorId', 'actorRole', 'actorContractorId', 'action',
  'targetType', 'targetId', 'details'
];

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'health');
    if (action === 'health') {
      return respond_({ ok: true, data: { service: 'workers-registry', version: SCHEMA_VERSION } });
    }
    throw new Error('此操作不允許公開存取');
  } catch (err) {
    return respond_({ ok: false, error: safeError_(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const result = dispatch_(
      String(body.action || ''),
      body.payload || {},
      String(body.publicSecret || ''),
      String(body.adminSecret || ''),
      String(body.actorToken || '')
    );
    return respond_({ ok: true, data: result });
  } catch (err) {
    return respond_({ ok: false, error: safeError_(err) });
  }
}

function dispatch_(action, payload, publicSecret, adminSecret, actorToken) {
  if (action === 'getPublicConfig' || action === 'getData') {
    requirePublicGateway_(publicSecret);
    const data = getPublicConfig_();
    if (action === 'getData') data.workers = [];
    return data;
  }
  if (action === 'addWorker' || action === 'submitRegistration') {
    requirePublicGateway_(publicSecret);
    return createWorker_(payload, null, 'public');
  }

  requireGateway_(adminSecret);
  if (action === 'adminLogin') return loginManager_(payload);

  const actor = requireActor_(actorToken);
  if (action === 'adminGetSession') return { profile: managerProfile_(actor) };
  if (action === 'adminExportSupabaseData') {
    requireOwner_(actor);
    return exportSupabaseDataAdmin_(actor);
  }
  if (action === 'adminChangePassword') return changePasswordAdmin_(payload, actor);
  if (actor.mustChangePassword === 'true') throw new Error('請先更換臨時密碼');

  switch (action) {
    case 'adminGetData': return getAdminData_(actor);
    case 'adminAddWorker': return createWorker_(payload, actor, 'manager');
    case 'adminUpdateWorker': return updateWorkerAdmin_(payload, actor);
    case 'adminDeleteWorker': return softDeleteWorkerAdmin_(payload, actor);
    case 'adminGetPhoto': return getPhotoAdmin_(payload, actor);
    case 'adminGenerateReport': return generateReportAdmin_(payload, actor);
    case 'adminGenerateReportFromPayload': return generateReportFromPayloadAdmin_(payload, actor);
    case 'adminUpdatePrimaryContractor':
      requireOwner_(actor);
      return updatePrimaryContractorAdmin_(payload, actor);
    case 'adminAddContractor':
      requireOwner_(actor);
      return addContractorAdmin_(payload, actor);
    case 'adminArchiveContractor':
      requireOwner_(actor);
      return archiveContractorAdmin_(payload, actor);
    case 'adminCreateManager':
      requireOwner_(actor);
      return createManagerAdmin_(payload, actor);
    case 'adminResetManagerPassword':
      requireOwner_(actor);
      return resetManagerPasswordAdmin_(payload, actor);
    case 'adminSetManagerStatus':
      requireOwner_(actor);
      return setManagerStatusAdmin_(payload, actor);
    case 'adminCreateBackup':
      requireOwner_(actor);
      return createBackupSnapshot_('manual', actor);
    default: throw new Error('不支援的操作');
  }
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeError_(err) {
  const message = err && err.message ? String(err.message) : '系統發生錯誤';
  console.error(err && err.stack ? err.stack : message);
  return message.slice(0, 300);
}

// 第一次部署時在 Apps Script 編輯器手動執行：
// setupSystem('GAS_ADMIN_SECRET', 'GAS_PUBLIC_SECRET', '主要管理者@gmail.com', '至少12碼英數密碼', '主要管理者姓名', '主承包商公司名稱')
function setupSystem(gatewaySecret, publicGatewaySecret, ownerEmail, ownerPassword, ownerName, primaryContractorName) {
  const secret = String(gatewaySecret || '').trim();
  const publicSecret = String(publicGatewaySecret || '').trim();
  const email = normalizeEmail_(ownerEmail);
  const password = validatePassword_(ownerPassword);
  const displayName = requireText_(ownerName, '主要管理者姓名', 60);
  const primaryName = requireText_(primaryContractorName, '主承包商公司名稱', 100);
  if (secret.length < 32) throw new Error('gatewaySecret 至少需要 32 個字元');
  if (publicSecret.length < 32) throw new Error('publicGatewaySecret 至少需要 32 個字元');
  if (constantTimeEqual_(secret, publicSecret)) throw new Error('公開與管理密鑰不可相同');

  const props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_API_SECRET', secret);
  props.setProperty('PUBLIC_API_SECRET', publicSecret);
  props.setProperty('ADMIN_EMAIL', email);
  if (!props.getProperty('PASSWORD_PEPPER')) {
    props.setProperty('PASSWORD_PEPPER', Utilities.getUuid() + Utilities.getUuid());
  }

  const ss = getDb_();
  const primaryContractor = upsertPrimaryContractor_(ss, primaryName, null);
  const folderPermissions = hardenPrivateFolderTree_(getRootFolder_());
  const databasePermissions = hardenPrivateItem_(DriveApp.getFileById(ss.getId()));
  const managerSheet = ss.getSheetByName('管理者');
  const now = new Date().toISOString();
  const existingOwner = readObjects_(managerSheet).find(item => item.role === 'owner');
  const salt = createSalt_();
  const values = {
    username: email,
    displayName: displayName,
    email: email,
    role: 'owner',
    contractorId: '',
    contractorName: '',
    passwordSalt: salt,
    passwordHash: hashPassword_(password, salt),
    status: 'active',
    mustChangePassword: 'false',
    sessionVersion: Utilities.getUuid(),
    failedAttempts: '0',
    lockedUntil: '',
    updatedAt: now
  };
  if (existingOwner) {
    updateRowById_(managerSheet, existingOwner.id, values);
  } else {
    values.id = Utilities.getUuid();
    values.createdAt = now;
    values.lastLoginAt = '';
    appendObject_(managerSheet, MANAGER_HEADERS, values);
  }
  props.setProperty('SCHEMA_VERSION', SCHEMA_VERSION);
  return {
    ok: true,
    databaseId: props.getProperty('DB_SPREADSHEET_ID'),
    ownerUsername: email,
    primaryContractor: contractorSummary_(primaryContractor),
    hardenedPermissions: folderPermissions.revoked + databasePermissions.revoked
  };
}

// 建議使用此無參數版本：先在「專案設定 > 指令碼屬性」加入
// ADMIN_API_SECRET、PUBLIC_API_SECRET、OWNER_EMAIL、OWNER_INITIAL_PASSWORD、OWNER_DISPLAY_NAME、PRIMARY_CONTRACTOR_NAME。
function setupSystemFromProperties() {
  const props = PropertiesService.getScriptProperties();
  const result = setupSystem(
    props.getProperty('ADMIN_API_SECRET'),
    props.getProperty('PUBLIC_API_SECRET'),
    props.getProperty('OWNER_EMAIL'),
    props.getProperty('OWNER_INITIAL_PASSWORD'),
    props.getProperty('OWNER_DISPLAY_NAME'),
    props.getProperty('PRIMARY_CONTRACTOR_NAME')
  );
  props.deleteProperty('OWNER_EMAIL');
  props.deleteProperty('OWNER_INITIAL_PASSWORD');
  props.deleteProperty('OWNER_DISPLAY_NAME');
  return result;
}

// 手動執行一次，讓目前 Apps Script 部署取得產生 PDF 所需的文件授權。
function authorizeSystemServices() {
  const name = '施工人員名冊_授權檢查_' + Date.now();
  const document = DocumentApp.create(name);
  document.saveAndClose();
  DriveApp.getFileById(document.getId()).setTrashed(true);
  return { ok: true };
}

// 既有系統升級時可單獨執行，不會重設主要管理者密碼。
function configurePrimaryContractorFromProperties() {
  const props = PropertiesService.getScriptProperties();
  const name = requireText_(props.getProperty('PRIMARY_CONTRACTOR_NAME'), '主承包商公司名稱', 100);
  const contractor = withScriptLock_(() => upsertPrimaryContractor_(getDb_(), name, null));
  return { ok: true, primaryContractor: contractorSummary_(contractor) };
}

function requirePublicGateway_(providedSecret) {
  const expected = PropertiesService.getScriptProperties().getProperty('PUBLIC_API_SECRET') || '';
  if (!expected || !constantTimeEqual_(providedSecret, expected)) throw new Error('未授權的公開操作');
}

function requireGateway_(providedSecret) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_API_SECRET') || '';
  if (!expected || !constantTimeEqual_(providedSecret, expected)) throw new Error('未授權的管理操作');
}

function requireActor_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw new Error('管理工作階段無效');

  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('ADMIN_API_SECRET') || '';
  const expected = base64Url_(
    Utilities.computeHmacSha256Signature(parts[0], secret, Utilities.Charset.UTF_8)
  );
  if (!constantTimeEqual_(parts[1], expected)) throw new Error('管理工作階段無效');

  let tokenData;
  try {
    tokenData = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8')
    );
  } catch (err) {
    throw new Error('管理工作階段無效');
  }

  const now = Math.floor(Date.now() / 1000);
  if (!tokenData.managerId || Number(tokenData.exp) < now || Number(tokenData.iat) > now + 60) {
    throw new Error('管理工作階段已逾時，請重新登入');
  }
  if (Number(tokenData.exp) - Number(tokenData.iat) > 600) throw new Error('管理工作階段無效');

  const manager = readObjects_(getDb_().getSheetByName('管理者'))
    .find(item => item.id === String(tokenData.managerId));
  if (!manager || manager.status !== 'active') throw new Error('此管理帳號已停用');
  if (!tokenData.sessionVersion || !manager.sessionVersion ||
      !constantTimeEqual_(tokenData.sessionVersion, manager.sessionVersion)) {
    throw new Error('管理工作階段已失效，請重新登入');
  }
  if (manager.role !== 'owner' && manager.role !== 'contractor') throw new Error('管理角色無效');

  if (manager.role === 'contractor') {
    const contractor = readObjects_(getDb_().getSheetByName('包商'))
      .find(item => item.id === manager.contractorId && (item.status || 'active') === 'active');
    if (!contractor) throw new Error('此帳號所屬承包商已停用');
    if (contractorType_(contractor) === CONTRACTOR_TYPE_PRIMARY) {
      throw new Error('主承包商僅能由主要管理者管理');
    }
    manager.contractorName = contractor.name;
  }
  return manager;
}

function requireOwner_(actor) {
  if (!actor || actor.role !== 'owner') throw new Error('僅主要管理者可執行此操作');
}

function constantTimeEqual_(a, b) {
  const left = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(a || ''),
    Utilities.Charset.UTF_8
  );
  const right = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(b || ''),
    Utilities.Charset.UTF_8
  );
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= left[i % left.length] ^ right[i % right.length];
  }
  return diff === 0;
}

function base64Url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function createSalt_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function hashPassword_(password, salt) {
  const pepper = PropertiesService.getScriptProperties().getProperty('PASSWORD_PEPPER') || '';
  if (!pepper) throw new Error('系統密碼保護尚未初始化');
  return base64Url_(
    Utilities.computeHmacSha256Signature(
      String(salt) + '\n' + String(password),
      pepper,
      Utilities.Charset.UTF_8
    )
  );
}

function validatePassword_(value) {
  const password = String(value || '');
  if (password.length < 12 || password.length > 128) throw new Error('密碼需為 12 至 128 個字元');
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error('密碼至少需包含一個英文字母及一個數字');
  }
  return password;
}

function normalizeEmail_(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email 格式不正確');
  return email;
}

function managerProfile_(manager) {
  return {
    id: manager.id,
    username: manager.username,
    displayName: manager.displayName,
    email: manager.email,
    role: manager.role,
    contractorId: manager.contractorId || '',
    contractorName: manager.contractorName || '',
    mustChangePassword: manager.mustChangePassword === 'true'
  };
}

function managerSummary_(manager) {
  return {
    id: manager.id,
    displayName: manager.displayName,
    email: manager.email,
    role: manager.role,
    contractorId: manager.contractorId || '',
    contractorName: manager.contractorName || '',
    status: manager.status,
    mustChangePassword: manager.mustChangePassword === 'true',
    createdAt: manager.createdAt,
    lastLoginAt: manager.lastLoginAt || ''
  };
}

function contractorType_(contractor) {
  return contractor && contractor.companyType === CONTRACTOR_TYPE_PRIMARY
    ? CONTRACTOR_TYPE_PRIMARY
    : CONTRACTOR_TYPE_SUBCONTRACTOR;
}

function contractorLevelLabel_(contractor) {
  return contractorType_(contractor) === CONTRACTOR_TYPE_PRIMARY ? '主承包商' : '次承包商';
}

function contractorSummary_(contractor) {
  return {
    id: contractor.id,
    name: contractor.name,
    companyType: contractorType_(contractor),
    levelLabel: contractorLevelLabel_(contractor),
    status: contractor.status || 'active',
    createdAt: contractor.createdAt || ''
  };
}

function sortContractors_(contractors) {
  return contractors.slice().sort((a, b) =>
    (contractorType_(a) === CONTRACTOR_TYPE_PRIMARY ? 0 : 1) -
      (contractorType_(b) === CONTRACTOR_TYPE_PRIMARY ? 0 : 1) ||
    String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant')
  );
}

function getPrimaryContractor_(db, knownContractors) {
  const props = PropertiesService.getScriptProperties();
  const contractors = Array.isArray(knownContractors)
    ? knownContractors.filter(item => (item.status || 'active') === 'active')
    : readObjects_(db.getSheetByName('包商'))
      .filter(item => (item.status || 'active') === 'active');
  const savedId = props.getProperty('PRIMARY_CONTRACTOR_ID') || '';
  const primary = contractors.find(item =>
    item.id === savedId && contractorType_(item) === CONTRACTOR_TYPE_PRIMARY
  ) || contractors.find(item => contractorType_(item) === CONTRACTOR_TYPE_PRIMARY) || null;
  if (primary) {
    if (props.getProperty('PRIMARY_CONTRACTOR_ID') !== primary.id) {
      props.setProperty('PRIMARY_CONTRACTOR_ID', primary.id);
    }
    if (props.getProperty('PRIMARY_CONTRACTOR_NAME') !== primary.name) {
      props.setProperty('PRIMARY_CONTRACTOR_NAME', primary.name);
    }
  }
  return primary;
}

function requirePrimaryContractor_(db, knownContractors) {
  const primary = getPrimaryContractor_(db, knownContractors);
  if (!primary) throw new Error('請先由主要管理者設定主承包商公司名稱');
  return primary;
}

function updateContractorDenormalizedNames_(db, contractorId, contractorName) {
  ['人員', '管理者'].forEach(sheetName => {
    const sheet = db.getSheetByName(sheetName);
    readObjects_(sheet)
      .filter(item => item.contractorId === contractorId && item.contractorName !== contractorName)
      .forEach(item => updateRowById_(sheet, item.id, { contractorName: contractorName }));
  });
}

function disableManagersForPrimaryContractor_(db, contractorId) {
  const sheet = db.getSheetByName('管理者');
  const now = new Date().toISOString();
  let disabled = 0;
  readObjects_(sheet)
    .filter(item =>
      item.role === 'contractor' &&
      item.contractorId === contractorId &&
      item.status === 'active'
    )
    .forEach(item => {
      updateRowById_(sheet, item.id, {
        status: 'disabled',
        sessionVersion: Utilities.getUuid(),
        updatedAt: now
      });
      revokeReportAccess_(item.email);
      disabled++;
    });
  return disabled;
}

function upsertPrimaryContractor_(db, name, actor, options) {
  const settings = options || {};
  const contractorName = requireText_(name, '主承包商公司名稱', 100);
  const sheet = db.getSheetByName('包商');
  const contractors = readObjects_(sheet);
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty('PRIMARY_CONTRACTOR_ID') || '';
  let primary = contractors.find(item => item.id === savedId) ||
    contractors.find(item => contractorType_(item) === CONTRACTOR_TYPE_PRIMARY) ||
    contractors.find(item => item.name === contractorName && (item.status || 'active') === 'active') ||
    contractors.find(item => item.name === contractorName) || null;
  const now = new Date().toISOString();

  if (primary) {
    updateRowById_(sheet, primary.id, {
      name: contractorName,
      companyType: CONTRACTOR_TYPE_PRIMARY,
      status: 'active',
      archivedAt: ''
    });
    primary = {
      ...primary,
      name: contractorName,
      companyType: CONTRACTOR_TYPE_PRIMARY,
      status: 'active',
      archivedAt: ''
    };
  } else {
    primary = {
      id: Utilities.getUuid(),
      name: contractorName,
      companyType: CONTRACTOR_TYPE_PRIMARY,
      createdAt: now,
      status: 'active',
      archivedAt: ''
    };
    appendObject_(sheet, CONTRACTOR_HEADERS, primary);
  }

  contractors
    .filter(item => item.id !== primary.id && contractorType_(item) === CONTRACTOR_TYPE_PRIMARY)
    .forEach(item => updateRowById_(sheet, item.id, { companyType: CONTRACTOR_TYPE_SUBCONTRACTOR }));

  props.setProperty('PRIMARY_CONTRACTOR_ID', primary.id);
  props.setProperty('PRIMARY_CONTRACTOR_NAME', primary.name);
  clearPublicConfigCache_();
  if (!settings.skipLegacyWorkerSync) {
    updateContractorDenormalizedNames_(db, primary.id, primary.name);
  }
  const disabledManagers = disableManagersForPrimaryContractor_(db, primary.id);
  if (!settings.skipDriveFolder) {
    getOrCreateSubfolder_(getRootFolder_(), safeName_(primary.name, 80));
  }
  if (actor) {
    writeAudit_(actor, 'update', 'primary_contractor', primary.id, primary.name + ':disabledManagers=' + disabledManagers);
  }
  return primary;
}

function updatePrimaryContractorAdmin_(input, actor) {
  return withScriptLock_(() => {
    const contractor = upsertPrimaryContractor_(getDb_(), input.name, actor, {
      skipDriveFolder: input.skipDriveFolder === true,
      skipLegacyWorkerSync: input.skipLegacyWorkerSync === true
    });
    return contractorSummary_(contractor);
  });
}

function loginManager_(input) {
  const username = normalizeEmail_(input.username);
  const password = String(input.password || '');
  if (!password) throw new Error('帳號或密碼錯誤');

  return withScriptLock_(() => {
    const sheet = getDb_().getSheetByName('管理者');
    const manager = readObjects_(sheet).find(item => item.username === username);
    if (!manager || manager.status !== 'active') throw new Error('帳號或密碼錯誤');

    const now = Date.now();
    const lockedUntil = manager.lockedUntil ? new Date(manager.lockedUntil).getTime() : 0;
    if (lockedUntil > now) throw new Error('登入嘗試次數過多，請稍後再試');

    const correct = constantTimeEqual_(
      hashPassword_(password, manager.passwordSalt),
      manager.passwordHash
    );
    if (!correct) {
      const attempts = Number(manager.failedAttempts || 0) + 1;
      const changes = { failedAttempts: String(attempts), updatedAt: new Date().toISOString() };
      if (attempts >= 5) changes.lockedUntil = new Date(now + 15 * 60 * 1000).toISOString();
      updateRowById_(sheet, manager.id, changes);
      throw new Error(attempts >= 5 ? '登入嘗試次數過多，請稍後再試' : '帳號或密碼錯誤');
    }

    const timestamp = new Date().toISOString();
    const sessionVersion = manager.sessionVersion || Utilities.getUuid();
    updateRowById_(sheet, manager.id, {
      failedAttempts: '0',
      lockedUntil: '',
      lastLoginAt: timestamp,
      sessionVersion: sessionVersion,
      updatedAt: timestamp
    });
    manager.failedAttempts = '0';
    manager.lockedUntil = '';
    manager.lastLoginAt = timestamp;
    manager.sessionVersion = sessionVersion;
    writeAudit_(manager, 'login', 'manager', manager.id, '');
    return { profile: managerProfile_(manager), sessionVersion: sessionVersion };
  });
}

function changePasswordAdmin_(input, actor) {
  const currentPassword = String(input.currentPassword || '');
  const newPassword = validatePassword_(input.newPassword);
  if (!constantTimeEqual_(
    hashPassword_(currentPassword, actor.passwordSalt),
    actor.passwordHash
  )) {
    throw new Error('目前密碼不正確');
  }
  if (constantTimeEqual_(
    hashPassword_(newPassword, actor.passwordSalt),
    actor.passwordHash
  )) {
    throw new Error('新密碼不可與目前密碼相同');
  }

  const salt = createSalt_();
  const sessionVersion = Utilities.getUuid();
  const now = new Date().toISOString();
  updateRowById_(getDb_().getSheetByName('管理者'), actor.id, {
    passwordSalt: salt,
    passwordHash: hashPassword_(newPassword, salt),
    mustChangePassword: 'false',
    sessionVersion: sessionVersion,
    failedAttempts: '0',
    lockedUntil: '',
    updatedAt: now
  });
  actor.mustChangePassword = 'false';
  actor.sessionVersion = sessionVersion;
  writeAudit_(actor, 'change_password', 'manager', actor.id, '');
  return { profile: managerProfile_(actor), sessionVersion: sessionVersion };
}

function createManagerAdmin_(input, actor) {
  return withScriptLock_(() => {
    const db = getDb_();
    const contractorId = requireText_(input.contractorId, '承包商', 100);
    const contractor = readObjects_(db.getSheetByName('包商'))
      .find(item => item.id === contractorId && (item.status || 'active') === 'active');
    if (!contractor) throw new Error('找不到有效的承包商');
    if (contractorType_(contractor) === CONTRACTOR_TYPE_PRIMARY) {
      throw new Error('主承包商僅由主要管理者管理，不可建立次管理者');
    }

    const sheet = db.getSheetByName('管理者');
    const managers = readObjects_(sheet);
    if (managers.some(item =>
      item.role === 'contractor' &&
      item.contractorId === contractorId &&
      item.status === 'active'
    )) {
      throw new Error('此承包商已有一位啟用中的次管理者');
    }

    const email = normalizeEmail_(input.email);
    if (managers.some(item => item.username === email)) throw new Error('此 Email 已建立過管理帳號');
    const password = validatePassword_(input.temporaryPassword);
    const salt = createSalt_();
    const now = new Date().toISOString();
    const manager = {
      id: Utilities.getUuid(),
      username: email,
      displayName: requireText_(input.displayName, '管理者姓名', 60),
      email: email,
      role: 'contractor',
      contractorId: contractor.id,
      contractorName: contractor.name,
      passwordSalt: salt,
      passwordHash: hashPassword_(password, salt),
      status: 'active',
      mustChangePassword: 'true',
      sessionVersion: Utilities.getUuid(),
      failedAttempts: '0',
      lockedUntil: '',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: ''
    };
    appendObject_(sheet, MANAGER_HEADERS, manager);
    writeAudit_(actor, 'create', 'manager', manager.id, contractor.name);
    return managerSummary_(manager);
  });
}

function resetManagerPasswordAdmin_(input, actor) {
  return withScriptLock_(() => {
    const db = getDb_();
    const sheet = db.getSheetByName('管理者');
    const managers = readObjects_(sheet);
    const manager = managers.find(item => item.id === String(input.id || ''));
    if (!manager || manager.role !== 'contractor') throw new Error('找不到次管理者');
    const contractor = readObjects_(db.getSheetByName('包商')).find(item =>
      item.id === manager.contractorId && (item.status || 'active') === 'active'
    );
    if (!contractor) throw new Error('此帳號所屬承包商已停用');
    if (contractorType_(contractor) === CONTRACTOR_TYPE_PRIMARY) {
      throw new Error('主承包商僅由主要管理者管理');
    }
    if (managers.some(item =>
      item.id !== manager.id &&
      item.role === 'contractor' &&
      item.contractorId === manager.contractorId &&
      item.status === 'active'
    )) {
      throw new Error('此承包商已有另一位啟用中的次管理者');
    }
    const password = validatePassword_(input.temporaryPassword);
    const salt = createSalt_();
    updateRowById_(sheet, manager.id, {
      passwordSalt: salt,
      passwordHash: hashPassword_(password, salt),
      mustChangePassword: 'true',
      sessionVersion: Utilities.getUuid(),
      failedAttempts: '0',
      lockedUntil: '',
      status: 'active',
      updatedAt: new Date().toISOString()
    });
    writeAudit_(actor, 'reset_password', 'manager', manager.id, manager.contractorName);
    return { id: manager.id };
  });
}

function setManagerStatusAdmin_(input, actor) {
  return withScriptLock_(() => {
    const id = requireText_(input.id, '管理者 ID', 100);
    const status = String(input.status || '');
    if (status !== 'active' && status !== 'disabled') throw new Error('帳號狀態不正確');
    const sheet = getDb_().getSheetByName('管理者');
    const managers = readObjects_(sheet);
    const manager = managers.find(item => item.id === id);
    if (!manager || manager.role !== 'contractor') throw new Error('找不到次管理者');
    if (status === 'active') {
      const contractor = readObjects_(getDb_().getSheetByName('包商')).find(item =>
        item.id === manager.contractorId && (item.status || 'active') === 'active'
      );
      if (!contractor) throw new Error('此帳號所屬承包商已停用');
      if (contractorType_(contractor) === CONTRACTOR_TYPE_PRIMARY) {
        throw new Error('主承包商僅由主要管理者管理');
      }
      if (managers.some(item =>
        item.id !== manager.id &&
        item.role === 'contractor' &&
        item.contractorId === manager.contractorId &&
        item.status === 'active'
      )) {
        throw new Error('此承包商已有另一位啟用中的次管理者');
      }
    }
    updateRowById_(sheet, id, {
      status: status,
      sessionVersion: Utilities.getUuid(),
      failedAttempts: '0',
      lockedUntil: '',
      updatedAt: new Date().toISOString()
    });
    const accessResult = status === 'disabled'
      ? revokeReportAccess_(manager.email)
      : { checked: 0, failed: 0 };
    writeAudit_(
      actor,
      status === 'active' ? 'enable' : 'disable',
      'manager',
      id,
      manager.contractorName + ':reports=' + accessResult.checked + ':failed=' + accessResult.failed
    );
    return { id: id, status: status };
  });
}

function withScriptLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function getRootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty('ROOT_FOLDER_ID');
  if (savedId) {
    try { return DriveApp.getFolderById(savedId); } catch (err) { console.warn('ROOT_FOLDER_ID 已失效'); }
  }
  const found = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  const folder = found.hasNext() ? found.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
  props.setProperty('ROOT_FOLDER_ID', folder.getId());
  return folder;
}

function getOrCreateSubfolder_(parent, name) {
  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

function hardenPrivateItem_(item) {
  item.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  const emails = {};
  item.getEditors().concat(item.getViewers()).forEach(user => {
    const email = String(user.getEmail() || '').trim().toLowerCase();
    if (email) emails[email] = true;
  });
  Object.keys(emails).forEach(email => item.revokePermissions(email));
  return { revoked: Object.keys(emails).length };
}

function hardenPrivateFolderTree_(folder) {
  let revoked = hardenPrivateItem_(folder).revoked;
  const children = folder.getFolders();
  while (children.hasNext()) {
    revoked += hardenPrivateFolderTree_(children.next()).revoked;
  }
  return { revoked: revoked };
}

function getDb_() {
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty('DB_SPREADSHEET_ID');
  let ss = null;
  if (savedId) {
    try { ss = SpreadsheetApp.openById(savedId); } catch (err) { console.warn('DB_SPREADSHEET_ID 已失效'); }
  }
  if (!ss) {
    const root = getRootFolder_();
    const found = root.getFilesByName(DB_FILE_NAME);
    if (found.hasNext()) {
      ss = SpreadsheetApp.open(found.next());
    } else {
      ss = SpreadsheetApp.create(DB_FILE_NAME);
      DriveApp.getFileById(ss.getId()).moveTo(root);
    }
    props.setProperty('DB_SPREADSHEET_ID', ss.getId());
  }
  ensureSchema_(ss);
  return ss;
}

function ensureSchema_(ss) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SCHEMA_VERSION') === SCHEMA_VERSION) return;
  const contractors = getOrCreateSheet_(ss, '包商');
  const workers = getOrCreateSheet_(ss, '人員');
  const managers = getOrCreateSheet_(ss, '管理者');
  const audit = getOrCreateSheet_(ss, '操作紀錄');
  ensureHeaders_(contractors, CONTRACTOR_HEADERS);
  ensureHeaders_(workers, WORKER_HEADERS);
  ensureHeaders_(managers, MANAGER_HEADERS);
  ensureHeaders_(audit, AUDIT_HEADERS);
  applyHeaderStyle_(contractors, contractors.getLastColumn());
  applyHeaderStyle_(workers, workers.getLastColumn());
  applyHeaderStyle_(managers, managers.getLastColumn());
  applyHeaderStyle_(audit, audit.getLastColumn());
  props.setProperty('SCHEMA_VERSION', SCHEMA_VERSION);
}

function getOrCreateSheet_(ss, name) {
  const existing = ss.getSheetByName(name);
  if (existing) return existing;
  const sheets = ss.getSheets();
  if (name === '包商' && sheets.length === 1 && sheets[0].getLastRow() === 0) {
    return sheets[0].setName(name);
  }
  return ss.insertSheet(name);
}

function ensureHeaders_(sheet, required) {
  const width = Math.max(sheet.getLastColumn(), 1);
  const current = sheet.getRange(1, 1, 1, width).getDisplayValues()[0].filter(String);
  if (!current.length) {
    sheet.getRange(1, 1, 1, required.length).setValues([required]);
    return;
  }
  const missing = required.filter(header => current.indexOf(header) === -1);
  if (missing.length) sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
}

function applyHeaderStyle_(sheet, columns) {
  sheet.getRange(1, 1, 1, columns)
    .setBackground('#C2410C')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
}

function readObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(value => String(value || ''));
  return values.slice(1).filter(row => row[0] !== '').map(row => {
    const result = {};
    headers.forEach((header, index) => {
      if (header) result[header] = normalizeCellValue_(row[index], header);
    });
    return result;
  });
}

function appendObject_(sheet, expectedHeaders, data) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const row = headers.map(header => escapeSheetValue_(data[header] == null ? '' : data[header]));
  const target = sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length);
  target.setNumberFormat('@');
  target.setValues([row]);
}

function normalizeCellValue_(value, header) {
  if (value instanceof Date) {
    return header === 'entryDate'
      ? Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : value.toISOString();
  }
  if (value == null) return '';
  return String(value);
}

function escapeSheetValue_(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function updateRowById_(sheet, id, changes) {
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) throw new Error('找不到資料');
  const headers = values[0];
  const idColumn = headers.indexOf('id');
  const rowIndex = values.findIndex((row, index) => index > 0 && row[idColumn] === id);
  if (rowIndex < 1) throw new Error('找不到資料');
  Object.keys(changes).forEach(key => {
    const column = headers.indexOf(key);
    if (column >= 0) {
      const cell = sheet.getRange(rowIndex + 1, column + 1);
      cell.setNumberFormat('@');
      cell.setValue(escapeSheetValue_(changes[key]));
    }
  });
}

function getPublicConfigCache_() {
  try {
    const cached = CacheService.getScriptCache().get(PUBLIC_CONFIG_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch (err) {
    console.warn('讀取公開設定快取失敗：' + err.message);
    return null;
  }
}

function clearPublicConfigCache_() {
  try {
    CacheService.getScriptCache().remove(PUBLIC_CONFIG_CACHE_KEY);
  } catch (err) {
    console.warn('清除公開設定快取失敗：' + err.message);
  }
  PropertiesService.getScriptProperties().deleteProperty(PUBLIC_CONFIG_PROPERTY_KEY);
}

function getPublicConfig_() {
  const cached = getPublicConfigCache_();
  if (cached) return cached;

  const props = PropertiesService.getScriptProperties();
  const snapshot = props.getProperty(PUBLIC_CONFIG_PROPERTY_KEY);
  if (snapshot) {
    try {
      const persisted = JSON.parse(snapshot);
      if (persisted && Array.isArray(persisted.contractors)) {
        try {
          CacheService.getScriptCache().put(
            PUBLIC_CONFIG_CACHE_KEY,
            snapshot,
            PUBLIC_CONFIG_CACHE_SECONDS
          );
        } catch (err) {
          console.warn('寫入公開設定快取失敗：' + err.message);
        }
        return persisted;
      }
    } catch (err) {
      console.warn('讀取公開設定快照失敗：' + err.message);
      props.deleteProperty(PUBLIC_CONFIG_PROPERTY_KEY);
    }
  }

  const db = getDb_();
  const activeContractors = readObjects_(db.getSheetByName('包商'))
    .filter(item => (item.status || 'active') === 'active');
  const contractors = sortContractors_(
    activeContractors
  ).map(contractorSummary_);
  const primary = getPrimaryContractor_(db, activeContractors);
  const result = {
    primaryContractor: primary ? contractorSummary_(primary) : null,
    contractors: contractors
  };
  try {
    const serialized = JSON.stringify(result);
    props.setProperty(PUBLIC_CONFIG_PROPERTY_KEY, serialized);
    CacheService.getScriptCache().put(PUBLIC_CONFIG_CACHE_KEY, serialized, PUBLIC_CONFIG_CACHE_SECONDS);
  } catch (err) {
    console.warn('寫入公開設定快取失敗：' + err.message);
  }
  return result;
}

function getAdminData_(actor) {
  const db = getDb_();
  const allContractors = sortContractors_(
    readObjects_(db.getSheetByName('包商'))
      .filter(item => (item.status || 'active') === 'active')
  );
  const allWorkers = readObjects_(db.getSheetByName('人員'))
    .filter(item => (item.status || 'active') === 'active');
  const owner = actor.role === 'owner';
  const scopedContractors = owner
    ? allContractors
    : allContractors.filter(item => item.id === actor.contractorId);
  const contractorMap = {};
  allContractors.forEach(item => { contractorMap[item.id] = item; });
  const workers = (owner
    ? allWorkers
    : allWorkers.filter(item => item.contractorId === actor.contractorId)
  ).map(item => sanitizeWorker_(item, contractorMap));
  const primary = getPrimaryContractor_(db, allContractors);

  return {
    profile: managerProfile_(actor),
    primaryContractor: primary ? contractorSummary_(primary) : null,
    contractors: scopedContractors.map(contractorSummary_),
    workers: workers,
    managers: owner
      ? readObjects_(db.getSheetByName('管理者'))
          .filter(item => item.role === 'contractor')
          .map(managerSummary_)
      : [],
    permissions: {
      manageContractors: owner,
      manageManagers: owner,
      viewAllContractors: owner,
      createBackup: owner
    }
  };
}

// 只供主要管理者透過 Netlify 進行一次性資料搬移；不回傳密碼雜湊或任何 Script Properties。
function exportSupabaseDataAdmin_(actor) {
  const db = getDb_();
  const contractors = readObjects_(db.getSheetByName('包商')).map(item => ({
    id: item.id,
    name: item.name,
    companyType: contractorType_(item),
    status: item.status || 'active',
    createdAt: item.createdAt || '',
    archivedAt: item.archivedAt || ''
  }));
  const workers = readObjects_(db.getSheetByName('人員')).map(item => ({
    id: item.id,
    name: item.name,
    idNumber: item.idNumber,
    phone: item.phone,
    emergencyContact: item.emergencyContact,
    emergencyPhone: item.emergencyPhone,
    bloodType: item.bloodType,
    jobTitle: item.jobTitle,
    contractorId: item.contractorId,
    contractorName: item.contractorName,
    entryDate: item.entryDate,
    notes: item.notes || '',
    photoFileId: item.photoFileId || extractDriveFileId_(item.photoUrl),
    createdAt: item.createdAt || '',
    status: item.status || 'active',
    deletedAt: item.deletedAt || '',
    updatedAt: item.updatedAt || item.createdAt || '',
    submissionId: item.submissionId || item.id,
    consentedAt: item.consentedAt || item.createdAt || '',
    source: item.source || 'legacy',
    createdById: item.createdById || '',
    createdByName: item.createdByName || ''
  }));
  const managers = readObjects_(db.getSheetByName('管理者'))
    .filter(item => item.role === 'owner' || item.role === 'contractor')
    .map(item => ({
      id: item.id,
      username: item.username,
      displayName: item.displayName,
      email: item.email,
      role: item.role,
      contractorId: item.contractorId || '',
      contractorName: item.contractorName || '',
      status: item.status || 'active',
      mustChangePassword: item.mustChangePassword === 'true',
      sessionVersion: item.sessionVersion || '',
      failedAttempts: item.failedAttempts || '0',
      lockedUntil: item.lockedUntil || '',
      createdAt: item.createdAt || '',
      updatedAt: item.updatedAt || '',
      lastLoginAt: item.lastLoginAt || ''
    }));
  const primary = getPrimaryContractor_(db, contractors);
  writeAudit_(actor, 'export', 'supabase', '', 'contractors=' + contractors.length + ':workers=' + workers.length);
  return {
    schemaVersion: SCHEMA_VERSION,
    primaryContractor: primary ? contractorSummary_(primary) : null,
    contractors: contractors,
    workers: workers,
    managers: managers
  };
}

function sanitizeWorker_(worker, contractorMap) {
  const contractor = contractorMap && contractorMap[worker.contractorId];
  return {
    id: worker.id,
    name: worker.name,
    idNumber: worker.idNumber,
    phone: worker.phone,
    emergencyContact: worker.emergencyContact,
    emergencyPhone: worker.emergencyPhone,
    bloodType: worker.bloodType,
    jobTitle: worker.jobTitle,
    contractorId: worker.contractorId,
    contractorName: worker.contractorName,
    companyType: contractorType_(contractor),
    companyLevelLabel: contractorLevelLabel_(contractor),
    entryDate: worker.entryDate,
    notes: worker.notes,
    createdAt: worker.createdAt,
    updatedAt: worker.updatedAt,
    hasPhoto: Boolean(worker.photoFileId || worker.photoUrl)
  };
}

function createWorker_(input, actor, source) {
  return withScriptLock_(() => {
    const db = getDb_();
    const contractorId = actor && actor.role === 'contractor'
      ? actor.contractorId
      : requireText_(input.contractorId, '所屬承包商', 100);
    const contractor = readObjects_(db.getSheetByName('包商'))
      .find(item => item.id === contractorId && (item.status || 'active') === 'active');
    if (!contractor) throw new Error('所選承包商不存在或已停用');

    const sheet = db.getSheetByName('人員');
    const existingWorkers = readObjects_(sheet);
    const submissionId = String(input.submissionId || '').trim() || Utilities.getUuid();
    const duplicateSubmission = existingWorkers.find(item => item.submissionId === submissionId);
    if (duplicateSubmission) return { receiptId: duplicateSubmission.id, duplicate: true };

    const idNumber = validateIdNumber_(input.idNumber);
    if (existingWorkers.some(item =>
      (item.status || 'active') === 'active' &&
      String(item.idNumber || '').toUpperCase() === idNumber
    )) {
      throw new Error('此身分證／居留證號已有在冊資料');
    }

    const now = new Date().toISOString();
    const worker = {
      id: Utilities.getUuid(),
      name: requireText_(input.name, '姓名', 60),
      idNumber: idNumber,
      phone: validatePhone_(input.phone, '聯絡電話'),
      emergencyContact: requireText_(input.emergencyContact, '緊急聯絡人', 60),
      emergencyPhone: validatePhone_(input.emergencyPhone, '緊急聯絡電話'),
      bloodType: requireBloodType_(input.bloodType),
      jobTitle: requireText_(input.jobTitle, '工作職稱', 80),
      contractorId: contractor.id,
      contractorName: contractor.name,
      entryDate: requireDate_(input.entryDate, '進場日期'),
      notes: optionalText_(input.notes, 500),
      createdAt: now,
      status: 'active',
      deletedAt: '',
      updatedAt: now,
      submissionId: submissionId,
      consentedAt: input.consent === true ? now : '',
      source: source,
      createdById: actor ? actor.id : '',
      createdByName: actor ? actor.displayName : '公開登錄'
    };
    if (!worker.consentedAt) throw new Error('請確認個資蒐集與使用同意');

    let photoFile = null;
    try {
      photoFile = savePrivatePhoto_(input.photo, worker, contractor.name);
      worker.photoFileId = photoFile.getId();
      worker.photoUrl = '';
      appendObject_(sheet, WORKER_HEADERS, worker);
      writeAudit_(actor, 'create', 'worker', worker.id, contractor.name, db);
      return { receiptId: worker.id, createdAt: now };
    } catch (err) {
      if (photoFile) {
        try { photoFile.setTrashed(true); } catch (cleanupErr) { console.warn(cleanupErr); }
      }
      throw err;
    }
  });
}

function updateWorkerAdmin_(input, actor) {
  return withScriptLock_(() => {
    const db = getDb_();
    const sheet = db.getSheetByName('人員');
    const workers = readObjects_(sheet);
    const id = requireText_(input.id, '人員 ID', 100);
    const existing = workers.find(item => item.id === id && (item.status || 'active') === 'active');
    if (!existing) throw new Error('找不到人員資料');
    assertWorkerAccess_(existing, actor);

    const contractorId = actor.role === 'contractor'
      ? actor.contractorId
      : requireText_(input.contractorId, '所屬承包商', 100);
    const contractor = readObjects_(db.getSheetByName('包商'))
      .find(item => item.id === contractorId && (item.status || 'active') === 'active');
    if (!contractor) throw new Error('所選承包商不存在或已停用');

    const idNumber = validateIdNumber_(input.idNumber);
    if (workers.some(item =>
      item.id !== id &&
      (item.status || 'active') === 'active' &&
      String(item.idNumber || '').toUpperCase() === idNumber
    )) {
      throw new Error('此身分證／居留證號已有在冊資料');
    }

    const now = new Date().toISOString();
    const changes = {
      name: requireText_(input.name, '姓名', 60),
      idNumber: idNumber,
      phone: validatePhone_(input.phone, '聯絡電話'),
      emergencyContact: requireText_(input.emergencyContact, '緊急聯絡人', 60),
      emergencyPhone: validatePhone_(input.emergencyPhone, '緊急聯絡電話'),
      bloodType: requireBloodType_(input.bloodType),
      jobTitle: requireText_(input.jobTitle, '工作職稱', 80),
      contractorId: contractor.id,
      contractorName: contractor.name,
      entryDate: requireDate_(input.entryDate, '進場日期'),
      notes: optionalText_(input.notes, 500),
      updatedAt: now
    };

    let newPhoto = null;
    try {
      if (input.photo) {
        newPhoto = savePrivatePhoto_(
          input.photo,
          { id: existing.id, name: changes.name },
          contractor.name
        );
        changes.photoFileId = newPhoto.getId();
        changes.photoUrl = '';
      }
      if (!newPhoto && !existing.photoFileId && !existing.photoUrl) throw new Error('照片為必填');
      updateRowById_(sheet, id, changes);
      if (newPhoto && existing.photoFileId) {
        try { DriveApp.getFileById(existing.photoFileId).setTrashed(true); } catch (err) { console.warn(err.message); }
      }
      writeAudit_(actor, 'update', 'worker', id, contractor.name, db);
      return { id: id, updatedAt: now };
    } catch (err) {
      if (newPhoto) {
        try { newPhoto.setTrashed(true); } catch (cleanupErr) { console.warn(cleanupErr); }
      }
      throw err;
    }
  });
}

function softDeleteWorkerAdmin_(input, actor) {
  return withScriptLock_(() => {
    const db = getDb_();
    const sheet = db.getSheetByName('人員');
    const id = requireText_(input.id, '人員 ID', 100);
    const worker = readObjects_(sheet)
      .find(item => item.id === id && (item.status || 'active') === 'active');
    if (!worker) throw new Error('找不到人員資料');
    assertWorkerAccess_(worker, actor);
    const now = new Date().toISOString();
    updateRowById_(sheet, id, {
      status: 'deleted',
      deletedAt: now,
      updatedAt: now
    });
    writeAudit_(actor, 'archive', 'worker', id, worker.contractorName, db);
    return { id: id };
  });
}

function assertWorkerAccess_(worker, actor) {
  if (actor.role === 'contractor' && worker.contractorId !== actor.contractorId) {
    throw new Error('無權存取其他承包商的人員資料');
  }
}

function getPhotoAdmin_(input, actor) {
  const worker = readObjects_(getDb_().getSheetByName('人員'))
    .find(item => item.id === String(input.id || '') && (item.status || 'active') === 'active');
  if (!worker) throw new Error('找不到人員資料');
  assertWorkerAccess_(worker, actor);
  const fileId = worker.photoFileId || extractDriveFileId_(worker.photoUrl);
  if (!fileId) throw new Error('此人員沒有照片');
  const blob = DriveApp.getFileById(fileId).getBlob();
  if (blob.getBytes().length > 2500000) throw new Error('照片檔案過大，無法在後台預覽');
  return {
    dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes())
  };
}

// Supabase 模式只把已完成權限檢查的資料交給 Apps Script 排版，不再重新掃描 Google Sheet。
function generateReportFromPayloadAdmin_(input, actor) {
  const type = String(input.type || '');
  if (type !== 'daily' && type !== 'company') throw new Error('報表類型不正確');
  const primaryInput = input.primaryContractor || {};
  const primaryName = requireText_(primaryInput.name, '主承包商公司名稱', 100);
  const primary = {
    id: String(primaryInput.id || ''),
    name: primaryName,
    companyType: CONTRACTOR_TYPE_PRIMARY
  };
  const contractorInput = input.contractor || null;
  const contractorId = type === 'company'
    ? (actor.role === 'contractor' ? actor.contractorId : requireText_(input.contractorId, '承包商', 100))
    : '';
  if (type === 'company' && (!contractorInput || String(contractorInput.id || '') !== contractorId)) {
    throw new Error('報表承包商資料不正確');
  }
  if (type === 'company' && actor.role === 'contractor' && contractorId !== actor.contractorId) {
    throw new Error('無權產生其他承包商的報表');
  }

  const payloadWorkers = Array.isArray(input.workers) ? input.workers : [];
  const workers = payloadWorkers.map(worker => {
    const workerContractorId = requireText_(worker.contractorId, '人員所屬承包商', 100);
    if (actor.role === 'contractor' && workerContractorId !== actor.contractorId) {
      throw new Error('報表含有未授權的人員資料');
    }
    if (type === 'company' && workerContractorId !== contractorId) {
      throw new Error('報表含有不屬於所選承包商的人員資料');
    }
    return {
      id: String(worker.id || ''),
      name: String(worker.name || ''),
      idNumber: String(worker.idNumber || ''),
      phone: String(worker.phone || ''),
      emergencyContact: String(worker.emergencyContact || ''),
      emergencyPhone: String(worker.emergencyPhone || ''),
      bloodType: String(worker.bloodType || ''),
      jobTitle: String(worker.jobTitle || ''),
      contractorId: workerContractorId,
      contractorName: String(worker.contractorName || ''),
      companyType: worker.companyType === CONTRACTOR_TYPE_PRIMARY
        ? CONTRACTOR_TYPE_PRIMARY
        : CONTRACTOR_TYPE_SUBCONTRACTOR,
      entryDate: String(worker.entryDate || ''),
      notes: String(worker.notes || ''),
      createdAt: String(worker.createdAt || ''),
      updatedAt: String(worker.updatedAt || ''),
      photoFileId: String(worker.photoFileId || ''),
      photoSignedUrl: validSupabasePhotoUrl_(worker.photoSignedUrl) ? worker.photoSignedUrl : ''
    };
  });

  let reportName = '';
  let scopeLabel = '';
  let dataBasis = '';
  let filenameLabel = '';
  if (type === 'daily') {
    const date = requireDate_(input.date, '報表日期');
    reportName = '每日新增人員名冊';
    scopeLabel = actor.role === 'contractor'
      ? '次承包商：' + actor.contractorName
      : '全部公司（含主承包商與次承包商）';
    dataBasis = '登記日期：' + date;
    filenameLabel = '每日新增_' + date;
    if (actor.role === 'contractor') filenameLabel += '_' + actor.contractorName;
  } else {
    reportName = '公司完整人員名冊';
    scopeLabel = contractorInput.companyType === CONTRACTOR_TYPE_PRIMARY
      ? '主承包商自有人員：' + contractorInput.name
      : '次承包商人員：' + contractorInput.name;
    dataBasis = '資料截至：' + Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy/MM/dd HH:mm:ss'
    );
    filenameLabel = '公司完整名冊_' + contractorInput.name;
  }

  workers.sort((a, b) =>
    (a.companyType === CONTRACTOR_TYPE_PRIMARY ? 0 : 1) -
      (b.companyType === CONTRACTOR_TYPE_PRIMARY ? 0 : 1) ||
    String(a.contractorName).localeCompare(String(b.contractorName), 'zh-Hant') ||
    String(a.name).localeCompare(String(b.name), 'zh-Hant')
  );
  const ownerEmail = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || '';
  const viewers = [ownerEmail, actor.email].filter((value, index, list) =>
    value && list.indexOf(value) === index
  );
  return createRosterPdf_({
    primaryContractorId: primary.id,
    primaryContractorName: primary.name,
    reportName: reportName,
    scopeLabel: scopeLabel,
    dataBasis: dataBasis,
    filenameLabel: filenameLabel
  }, workers, viewers);
}

function validSupabasePhotoUrl_(value) {
  const url = String(value || '');
  return /^https:\/\/[^\s/]+\.supabase\.co\/storage\/v1\/object\/sign\/worker-photos\//i.test(url);
}

function requireText_(value, label, maxLength) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new Error(label + '為必填');
  if (text.length > maxLength) throw new Error(label + '長度超過限制');
  return text;
}

function optionalText_(value, maxLength) {
  const text = String(value == null ? '' : value).trim();
  if (text.length > maxLength) throw new Error('備註長度超過限制');
  return text;
}

function requireDate_(value, label) {
  const text = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error(label + '格式不正確');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day) {
    throw new Error(label + '格式不正確');
  }
  return text;
}

function validateIdNumber_(value) {
  const idNumber = requireText_(value, '身分證／居留證號', 20).toUpperCase();
  if (!/^[A-Z][A-Z0-9][0-9]{8}$/.test(idNumber)) {
    throw new Error('身分證／居留證號格式不正確');
  }
  const second = idNumber.charAt(1);
  if (/^[0-9]$/.test(second) && ['1', '2', '8', '9'].indexOf(second) === -1) {
    throw new Error('身分證／居留證號格式不正確');
  }

  const areaCode = TAIWAN_ID_AREA_CODES[idNumber.charAt(0)];
  const body = idNumber.slice(1, 9).split('').map((character, index) => {
    if (index === 0 && /^[A-Z]$/.test(character)) {
      return TAIWAN_ID_AREA_CODES[character] % 10;
    }
    return Number(character);
  });
  const digits = [Math.floor(areaCode / 10), areaCode % 10].concat(body);
  const weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const sum = digits.reduce((total, digit, index) =>
    total + ((digit * weights[index]) % 10), 0
  );
  const checkDigit = sum % 10 === 0 ? 0 : 10 - (sum % 10);
  if (checkDigit !== Number(idNumber.charAt(9))) {
    throw new Error('身分證／居留證號檢查碼不正確');
  }
  return idNumber;
}

function requireBloodType_(value) {
  const bloodType = String(value || '').trim().toUpperCase();
  if (['A', 'B', 'AB', 'O'].indexOf(bloodType) === -1) throw new Error('請選擇血型');
  return bloodType;
}

function validatePhone_(value, label) {
  const phone = requireText_(value, label, 30);
  if (!/^[0-9+()\-\s]{7,30}$/.test(phone)) throw new Error(label + '格式不正確');
  return phone;
}

function savePrivatePhoto_(dataUrl, worker, contractorName) {
  const source = String(dataUrl || '');
  const match = source.match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error('照片為必填，且格式必須是 JPG 或 PNG');
  if (match[2].length > 8000000) throw new Error('照片檔案過大，請重新裁切後上傳');

  const bytes = Utilities.base64Decode(match[2]);
  const signature = bytes.slice(0, 8).map(value => value & 255);
  const png = match[1].toLowerCase() === 'png';
  const validPng = png && signature.length >= 8 &&
    signature[0] === 137 && signature[1] === 80 && signature[2] === 78 && signature[3] === 71 &&
    signature[4] === 13 && signature[5] === 10 && signature[6] === 26 && signature[7] === 10;
  const validJpeg = !png && signature.length >= 3 &&
    signature[0] === 255 && signature[1] === 216 && signature[2] === 255;
  if (!validPng && !validJpeg) throw new Error('照片內容不是有效的 JPG 或 PNG');

  const contractorFolder = getOrCreateSubfolder_(getRootFolder_(), safeName_(contractorName, 80));
  const photoFolder = getOrCreateSubfolder_(contractorFolder, '照片');
  const mimeType = png ? 'image/png' : 'image/jpeg';
  const extension = png ? '.png' : '.jpg';
  const blob = Utilities.newBlob(
    bytes,
    mimeType,
    safeName_(worker.name + '_' + worker.id + extension, 120)
  );
  return photoFolder.createFile(blob);
}

function safeName_(value, maxLength) {
  return String(value || '未命名').replace(/[\\/:*?"<>|]/g, '_').slice(0, maxLength);
}

function addContractorAdmin_(input, actor) {
  return withScriptLock_(() => {
    const db = getDb_();
    const name = requireText_(input.name, '次承包商名稱', 100);
    const existing = readObjects_(db.getSheetByName('包商'))
      .find(item => item.name === name && (item.status || 'active') === 'active');
    if (existing) throw new Error('承包商已存在');
    const contractor = {
      id: Utilities.getUuid(),
      name: name,
      companyType: CONTRACTOR_TYPE_SUBCONTRACTOR,
      createdAt: new Date().toISOString(),
      status: 'active',
      archivedAt: ''
    };
    appendObject_(db.getSheetByName('包商'), CONTRACTOR_HEADERS, contractor);
    if (input.skipDriveFolder !== true) {
      getOrCreateSubfolder_(getRootFolder_(), safeName_(name, 80));
    }
    clearPublicConfigCache_();
    writeAudit_(actor, 'create', 'contractor', contractor.id, name);
    return contractor;
  });
}

function archiveContractorAdmin_(input, actor) {
  return withScriptLock_(() => {
    const db = getDb_();
    const id = requireText_(input.id, '承包商 ID', 100);
    const contractor = readObjects_(db.getSheetByName('包商'))
      .find(item => item.id === id && (item.status || 'active') === 'active');
    if (!contractor) throw new Error('找不到承包商');
    if (contractorType_(contractor) === CONTRACTOR_TYPE_PRIMARY) {
      throw new Error('主承包商不可封存；如需更名請至帳號與系統設定');
    }
    if (input.skipLegacyWorkerCheck !== true) {
      const activeWorkers = readObjects_(db.getSheetByName('人員'))
        .filter(item => item.contractorId === id && (item.status || 'active') === 'active');
      if (activeWorkers.length) throw new Error('此承包商仍有在冊人員，無法封存');
    }

    const now = new Date().toISOString();
    updateRowById_(db.getSheetByName('包商'), id, { status: 'archived', archivedAt: now });
    clearPublicConfigCache_();
    readObjects_(db.getSheetByName('管理者'))
      .filter(item => item.contractorId === id && item.status === 'active')
      .forEach(item => {
        updateRowById_(db.getSheetByName('管理者'), item.id, {
          status: 'disabled',
          sessionVersion: Utilities.getUuid(),
          updatedAt: now
        });
        revokeReportAccess_(item.email);
      });
    writeAudit_(actor, 'archive', 'contractor', id, contractor.name);
    return { id: id };
  });
}

function writeAudit_(actor, action, targetType, targetId, details, db) {
  const database = db || getDb_();
  appendObject_(database.getSheetByName('操作紀錄'), AUDIT_HEADERS, {
    timestamp: new Date().toISOString(),
    actorId: actor ? actor.id : 'public',
    actorRole: actor ? actor.role : 'public',
    actorContractorId: actor ? (actor.contractorId || '') : '',
    action: action,
    targetType: targetType,
    targetId: targetId,
    details: String(details || '').slice(0, 200)
  });
}

function revokeReportAccess_(email) {
  const targetEmail = String(email || '').trim().toLowerCase();
  if (!targetEmail) return { checked: 0, failed: 0 };
  const folders = getRootFolder_().getFoldersByName(REPORT_FOLDER_NAME);
  if (!folders.hasNext()) return { checked: 0, failed: 0 };

  let checked = 0;
  let failed = 0;
  const files = folders.next().getFiles();
  while (files.hasNext()) {
    const file = files.next();
    try {
      file.removeViewer(targetEmail);
      checked++;
    } catch (err) {
      failed++;
      console.warn('撤銷報表權限失敗：' + file.getId() + ' ' + err.message);
    }
  }
  return { checked: checked, failed: failed };
}

function generateReportAdmin_(input, actor) {
  const type = String(input.type || '');
  if (type !== 'daily' && type !== 'company') throw new Error('報表類型不正確');
  const db = getDb_();
  const contractors = readObjects_(db.getSheetByName('包商'))
    .filter(item => (item.status || 'active') === 'active');
  const primary = requirePrimaryContractor_(db, contractors);
  const contractorMap = {};
  contractors.forEach(item => { contractorMap[item.id] = item; });
  let workers = readObjects_(db.getSheetByName('人員'))
    .filter(item => (item.status || 'active') === 'active');
  if (actor.role === 'contractor') {
    workers = workers.filter(item => item.contractorId === actor.contractorId);
  }

  let filenameLabel = '';
  let reportName = '';
  let scopeLabel = '';
  let dataBasis = '';
  if (type === 'daily') {
    const date = requireDate_(input.date, '報表日期');
    workers = workers.filter(worker => formatDateKey_(worker.createdAt) === date);
    reportName = '每日新增人員名冊';
    scopeLabel = actor.role === 'contractor'
      ? '次承包商：' + actor.contractorName
      : '全部公司（含主承包商與次承包商）';
    dataBasis = '登記日期：' + date;
    filenameLabel = '每日新增_' + date;
    if (actor.role === 'contractor') filenameLabel += '_' + actor.contractorName;
  } else {
    const contractorId = actor.role === 'contractor'
      ? actor.contractorId
      : requireText_(input.contractorId, '承包商', 100);
    const contractor = contractors.find(item => item.id === contractorId);
    if (!contractor) throw new Error('找不到承包商');
    workers = workers.filter(worker => worker.contractorId === contractorId);
    reportName = '公司完整人員名冊';
    scopeLabel = contractorType_(contractor) === CONTRACTOR_TYPE_PRIMARY
      ? '主承包商自有人員：' + contractor.name
      : '次承包商人員：' + contractor.name;
    dataBasis = '資料截至：' + Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy/MM/dd HH:mm:ss'
    );
    filenameLabel = '公司完整名冊_' + contractor.name;
  }

  workers.sort((a, b) =>
    (contractorType_(contractorMap[a.contractorId]) === CONTRACTOR_TYPE_PRIMARY ? 0 : 1) -
      (contractorType_(contractorMap[b.contractorId]) === CONTRACTOR_TYPE_PRIMARY ? 0 : 1) ||
    String(a.contractorName).localeCompare(String(b.contractorName), 'zh-Hant') ||
    String(a.name).localeCompare(String(b.name), 'zh-Hant')
  );
  workers = workers.map(worker => ({
    ...worker,
    companyType: contractorType_(contractorMap[worker.contractorId])
  }));
  const ownerEmail = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || '';
  const viewers = [ownerEmail, actor.email].filter((value, index, list) =>
    value && list.indexOf(value) === index
  );
  const report = {
    primaryContractorId: primary.id,
    primaryContractorName: primary.name,
    reportName: reportName,
    scopeLabel: scopeLabel,
    dataBasis: dataBasis,
    filenameLabel: filenameLabel
  };
  const result = createRosterPdf_(report, workers, viewers);
  writeAudit_(actor, 'generate_pdf', 'report', result.fileId, filenameLabel + ':' + workers.length);
  return result;
}

function styleDocumentText_(element, fontSize, bold, color) {
  const text = element.editAsText();
  text.setFontFamily('Noto Sans TC');
  text.setFontSize(Math.max(REPORT_MIN_FONT_SIZE, Number(fontSize) || REPORT_MIN_FONT_SIZE));
  if (bold != null) text.setBold(Boolean(bold));
  if (color) text.setForegroundColor(color);
  return element;
}

function appendWorkerDetail_(cell, label, value, bold) {
  const paragraph = cell.appendParagraph(label + '：' + (value || '—'));
  paragraph.setSpacingBefore(0).setSpacingAfter(0).setLineSpacing(1);
  styleDocumentText_(paragraph, REPORT_MIN_FONT_SIZE, Boolean(bold), '#202124');
  return paragraph;
}

function estimateWorkerPageUnits_(worker) {
  const notesLength = String(worker.notes || '').length;
  return Math.min(3, 1 + Math.ceil(Math.max(0, notesLength - 80) / 160));
}

function createRosterPdf_(report, workers, viewerEmails) {
  const now = new Date();
  const stamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const filename = safeName_(
    report.primaryContractorName + '_施工人員名冊_' + report.filenameLabel + '_' + stamp + '.pdf',
    150
  );
  const doc = DocumentApp.create(filename.replace(/\.pdf$/i, ''));
  const body = doc.getBody();
  body
    .setPageWidth(595.28)
    .setPageHeight(841.89)
    .setMarginTop(28)
    .setMarginBottom(34)
    .setMarginLeft(36)
    .setMarginRight(36);

  const header = doc.addHeader();
  const primaryHeading = header.appendParagraph('主承包商：' + report.primaryContractorName);
  primaryHeading.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingAfter(1);
  styleDocumentText_(primaryHeading, 15, true, '#202124');
  const reportHeading = header.appendParagraph('施工人員名冊｜' + report.reportName);
  reportHeading.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingAfter(4);
  styleDocumentText_(reportHeading, 13, true, '#C2410C');

  const footer = doc.addFooter();
  const footerText = footer.appendParagraph(
    '機密文件｜個人資料，僅供本案管理與業主審查使用｜產製：' +
    Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss')
  );
  footerText.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  styleDocumentText_(footerText, REPORT_MIN_FONT_SIZE, false, '#71717A');

  const metaTable = body.appendTable([
    ['報表範圍', report.scopeLabel],
    ['資料基準', report.dataBasis],
    ['人員筆數', String(workers.length)]
  ]);
  metaTable.setBorderColor('#D4D4D8').setBorderWidth(0.75);
  metaTable.setColumnWidth(0, 92).setColumnWidth(1, 431);
  for (let rowIndex = 0; rowIndex < metaTable.getNumRows(); rowIndex++) {
    const row = metaTable.getRow(rowIndex);
    const labelCell = row.getCell(0);
    const valueCell = row.getCell(1);
    labelCell.setBackgroundColor('#F4F4F5');
    [labelCell, valueCell].forEach(cell => {
      cell.setPaddingTop(4).setPaddingBottom(4).setPaddingLeft(6).setPaddingRight(6);
      styleDocumentText_(cell, REPORT_MIN_FONT_SIZE, cell === labelCell, '#202124');
    });
  }
  body.appendParagraph('').setSpacingAfter(2);

  if (!workers.length) {
    const empty = body.appendParagraph('此篩選條件目前無人員資料。');
    empty.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(24);
    styleDocumentText_(empty, REPORT_MIN_FONT_SIZE, false, '#71717A');
  } else {
    let pageUnits = 0;
    workers.forEach((worker, index) => {
      const units = estimateWorkerPageUnits_(worker);
      if (pageUnits > 0 && pageUnits + units > 3) {
        body.appendPageBreak();
        pageUnits = 0;
      }
      appendWorkerToDocument_(body, worker, index);
      pageUnits += units;
    });
  }
  doc.saveAndClose();

  const reports = getOrCreateSubfolder_(getRootFolder_(), REPORT_FOLDER_NAME);
  const source = DriveApp.getFileById(doc.getId());
  const pdfFile = reports.createFile(source.getAs(MimeType.PDF).setName(filename));
  pdfFile.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  pdfFile.setShareableByEditors(false);
  (viewerEmails || []).forEach(email => {
    try { pdfFile.addViewer(email); } catch (err) { console.warn(err.message); }
  });
  source.setTrashed(true);
  return {
    fileId: pdfFile.getId(),
    filename: filename,
    url: pdfFile.getUrl(),
    count: workers.length,
    primaryContractorName: report.primaryContractorName,
    scopeLabel: report.scopeLabel
  };
}

function appendWorkerToDocument_(body, worker, index) {
  const title = body.appendParagraph((index + 1) + '. ' + worker.name + '｜' + worker.jobTitle);
  title.setSpacingBefore(4).setSpacingAfter(3);
  styleDocumentText_(title, 14, true, '#202124');
  const table = body.appendTable([['', '']]);
  table.setBorderColor('#A1A1AA').setBorderWidth(0.75);
  table.setColumnWidth(0, 108).setColumnWidth(1, 415);
  const photoCell = table.getRow(0).getCell(0);
  const detailsCell = table.getRow(0).getCell(1);
  photoCell.clear();
  detailsCell.clear();
  photoCell
    .setPaddingTop(0)
    .setPaddingBottom(0)
    .setPaddingLeft(0)
    .setPaddingRight(0)
    .setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);
  detailsCell
    .setPaddingTop(2)
    .setPaddingBottom(2)
    .setPaddingLeft(7)
    .setPaddingRight(4)
    .setVerticalAlignment(DocumentApp.VerticalAlignment.TOP);

  const photoId = worker.photoFileId || extractDriveFileId_(worker.photoUrl);
  let photoBlob = null;
  if (worker.photoSignedUrl) {
    try {
      const response = UrlFetchApp.fetch(worker.photoSignedUrl, { muteHttpExceptions: true });
      if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
        const candidate = response.getBlob();
        if (/^image\/(jpeg|jpg|png)$/i.test(candidate.getContentType()) && candidate.getBytes().length <= 2500000) {
          photoBlob = candidate;
        }
      }
    } catch (err) {
      console.warn('Supabase 照片讀取失敗：' + err.message);
    }
  }
  if (!photoBlob && photoId) {
    try {
      photoBlob = DriveApp.getFileById(photoId).getBlob();
    } catch (err) {
      console.warn('Drive 照片讀取失敗：' + err.message);
    }
  }
  if (photoBlob) {
    photoCell.appendImage(photoBlob)
      .setWidth(REPORT_PHOTO_WIDTH_PT)
      .setHeight(REPORT_PHOTO_HEIGHT_PT);
  } else if (photoId || worker.photoSignedUrl) {
    photoCell.appendParagraph('照片無法讀取');
  } else {
    photoCell.appendParagraph('未附照片');
  }

  appendWorkerDetail_(
    detailsCell,
    '人員類別',
    worker.companyType === CONTRACTOR_TYPE_PRIMARY ? '主承包商自有人員' : '次承包商人員',
    true
  );
  appendWorkerDetail_(detailsCell, '所屬公司', worker.contractorName, true);
  appendWorkerDetail_(detailsCell, '身分證／居留證號', worker.idNumber);
  appendWorkerDetail_(detailsCell, '聯絡電話', worker.phone);
  appendWorkerDetail_(detailsCell, '血型', worker.bloodType);
  appendWorkerDetail_(detailsCell, '緊急聯絡人', worker.emergencyContact);
  appendWorkerDetail_(detailsCell, '緊急聯絡電話', worker.emergencyPhone);
  appendWorkerDetail_(detailsCell, '進場日期', worker.entryDate);
  appendWorkerDetail_(detailsCell, '登記時間', formatDateTime_(worker.createdAt));
  appendWorkerDetail_(detailsCell, '最後更新', formatDateTime_(worker.updatedAt));
  appendWorkerDetail_(detailsCell, '備註', worker.notes || '—');
}

function extractDriveFileId_(url) {
  const text = String(url || '');
  const match = text.match(/[?&]id=([A-Za-z0-9_-]+)/) || text.match(/\/d\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : '';
}

function formatDateKey_(value) {
  const date = new Date(value);
  return isNaN(date.getTime())
    ? ''
    : Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function formatDateTime_(value) {
  const date = new Date(value);
  return isNaN(date.getTime())
    ? String(value || '—')
    : Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss');
}

function createBackupSnapshot_(source, actor) {
  const ss = getDb_();
  const folder = getOrCreateSubfolder_(getRootFolder_(), BACKUP_FOLDER_NAME);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const copy = DriveApp.getFileById(ss.getId()).makeCopy(DB_FILE_NAME + '_備份_' + stamp, folder);
  writeAudit_(actor || null, 'backup', 'spreadsheet', copy.getId(), source || 'manual');
  return { fileId: copy.getId(), name: copy.getName(), url: copy.getUrl() };
}

function createDailyBackup() {
  return createBackupSnapshot_('daily_trigger', null);
}

// 手動執行一次，建立每日凌晨 2 點的自動備份。
function installDailyBackupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'createDailyBackup')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('createDailyBackup').timeBased().atHour(2).everyDays(1).create();
  return { ok: true };
}

// 新版上線後手動執行一次：補齊舊欄位並撤銷照片公開權限。
function migrateAndHardenExistingData() {
  const db = getDb_();
  const folderPermissions = hardenPrivateFolderTree_(getRootFolder_());
  const databasePermissions = hardenPrivateItem_(DriveApp.getFileById(db.getId()));
  const workerSheet = db.getSheetByName('人員');
  const values = workerSheet.getDataRange().getDisplayValues();
  const headers = values[0];
  const columns = {};
  headers.forEach((header, index) => { columns[header] = index; });
  let hardened = 0;

  values.slice(1).forEach((row, offset) => {
    if (!row[0]) return;
    const sheetRow = offset + 2;
    const fileId = row[columns.photoFileId] || extractDriveFileId_(row[columns.photoUrl]);
    if (fileId) {
      workerSheet.getRange(sheetRow, columns.photoFileId + 1).setValue(fileId);
      workerSheet.getRange(sheetRow, columns.photoUrl + 1).setValue('');
      try {
        hardenPrivateItem_(DriveApp.getFileById(fileId));
        hardened++;
      } catch (err) {
        console.warn('照片權限調整失敗：' + fileId + ' ' + err.message);
      }
    }
    if (!row[columns.status]) workerSheet.getRange(sheetRow, columns.status + 1).setValue('active');
    if (!row[columns.updatedAt]) workerSheet.getRange(sheetRow, columns.updatedAt + 1).setValue(new Date().toISOString());
    if (!row[columns.source]) workerSheet.getRange(sheetRow, columns.source + 1).setValue('legacy');
  });

  const contractorSheet = db.getSheetByName('包商');
  const contractorValues = contractorSheet.getDataRange().getDisplayValues();
  const contractorHeaders = contractorValues[0];
  const statusColumn = contractorHeaders.indexOf('status');
  const typeColumn = contractorHeaders.indexOf('companyType');
  contractorValues.slice(1).forEach((row, offset) => {
    if (row[0] && !row[statusColumn]) {
      contractorSheet.getRange(offset + 2, statusColumn + 1).setValue('active');
    }
    if (row[0] && !row[typeColumn]) {
      contractorSheet.getRange(offset + 2, typeColumn + 1).setValue(CONTRACTOR_TYPE_SUBCONTRACTOR);
    }
  });
  const configuredPrimaryName = PropertiesService.getScriptProperties()
    .getProperty('PRIMARY_CONTRACTOR_NAME');
  const primary = configuredPrimaryName
    ? upsertPrimaryContractor_(db, configuredPrimaryName, null)
    : getPrimaryContractor_(db);
  return {
    ok: true,
    hardenedPhotos: hardened,
    primaryContractor: primary ? contractorSummary_(primary) : null,
    revokedFolderAndDatabasePermissions: folderPermissions.revoked + databasePermissions.revoked
  };
}
