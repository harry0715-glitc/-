import { randomUUID } from 'node:crypto';

import {
  SupabaseError,
  isSupabaseConfigured,
  supabaseCreateSignedPhotoUrl,
  supabaseCreateSignedObjectUrl,
  supabaseDeletePhoto,
  supabaseDownloadPhoto,
  supabaseEnsurePrivateBucket,
  supabaseInsert,
  supabaseSelect,
  supabaseUpdate,
  supabaseUploadObject,
  supabaseUploadPhoto,
  supabaseUpsert,
} from './supabase-client.mjs';

const MAX_PHOTO_CHARACTERS = 8_100_000;
const MAX_PREVIEW_BYTES = 2_500_000;
const BACKUP_BUCKET = 'registry-backups';
const MAX_BACKUP_BYTES = 25_000_000;
const BACKUP_LINK_TTL_SECONDS = 10 * 60;
const TAIWAN_ID_AREA_CODES = {
  A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17,
  I: 34, J: 18, K: 19, L: 20, M: 21, N: 22, O: 35, P: 23,
  Q: 24, R: 25, S: 26, T: 27, U: 28, V: 29, W: 32, X: 30,
  Y: 31, Z: 33,
};

export function supabaseIsReady() {
  return isSupabaseConfigured();
}

export async function getPublicConfigFromSupabase() {
  const rows = await supabaseSelect('contractors', {
    status: 'eq.active',
    order: 'company_type.asc,name.asc',
  });
  const contractors = rows
    .map(contractorSummaryFromRow)
    .sort(compareContractors);
  const primaryContractor = contractors.find((item) => item.companyType === 'primary') || null;
  return { primaryContractor, contractors };
}

export async function submitRegistrationToSupabase(input) {
  return createWorkerInSupabase(input, null, 'public');
}

export async function getManagerBySession(managerId, sessionVersion) {
  const rows = await supabaseSelect('managers', {
    select: 'id,username,display_name,email,role,contractor_id,contractor_name,status,must_change_password,session_version',
    id: `eq.${managerId}`,
    session_version: `eq.${sessionVersion}`,
    status: 'eq.active',
    limit: '1',
  });
  return rows[0] ? managerFromRow(rows[0]) : null;
}

export function managerProfileFromSession(actor) {
  return managerProfileFromActor(actor);
}

export async function syncManagerFromLogin(profile, sessionVersion) {
  if (!profile?.id || !sessionVersion || !isSupabaseConfigured()) return null;
  const row = {
    id: String(profile.id),
    username: String(profile.username || profile.email || '').trim().toLowerCase(),
    display_name: String(profile.displayName || profile.email || '管理者').trim(),
    email: String(profile.email || profile.username || '').trim().toLowerCase(),
    role: profile.role === 'owner' ? 'owner' : 'contractor',
    contractor_id: profile.contractorId ? String(profile.contractorId) : null,
    contractor_name: String(profile.contractorName || ''),
    status: 'active',
    must_change_password: Boolean(profile.mustChangePassword),
    session_version: String(sessionVersion),
    updated_at: new Date().toISOString(),
  };
  const rows = await supabaseUpsert('managers', row);
  return rows[0] ? managerFromRow(rows[0]) : managerFromRow(row);
}

export async function getAdminDataFromSupabase(actor) {
  const owner = actor.role === 'owner';
  const workerParams = { status: 'eq.active', order: 'created_at.desc' };
  if (!owner) workerParams.contractor_id = `eq.${actor.contractorId}`;
  const [contractorRows, workerRows, managerRows] = await Promise.all([
    supabaseSelect('contractors', {
      select: 'id,name,company_type,status,created_at',
      status: 'eq.active',
      order: 'company_type.asc,name.asc',
    }),
    supabaseSelect('workers', {
      select: 'id,name,id_number,phone,emergency_contact,emergency_phone,blood_type,job_title,contractor_id,contractor_name,entry_date,notes,photo_storage_path,photo_file_id,created_at,updated_at',
      ...workerParams,
    }),
    owner
      ? supabaseSelect('managers', {
        select: 'id,display_name,email,role,contractor_id,contractor_name,status,must_change_password,created_at,last_login_at',
        role: 'eq.contractor',
        order: 'created_at.desc',
      })
      : Promise.resolve([]),
  ]);
  const contractors = contractorRows.map(contractorSummaryFromRow).sort(compareContractors);
  const contractorMap = Object.fromEntries(contractors.map((item) => [item.id, item]));
  const workers = workerRows.map((row) => workerSummaryFromRow(row, contractorMap));
  const managers = managerRows.map(managerSummaryFromRow);
  const primaryContractor = contractors.find((item) => item.companyType === 'primary') || null;

  return {
    dataSource: 'supabase',
    profile: managerProfileFromActor(actor),
    primaryContractor,
    contractors: owner
      ? contractors
      : contractors.filter((item) => item.id === actor.contractorId),
    workers,
    managers,
    permissions: {
      manageContractors: owner,
      manageManagers: owner,
      viewAllContractors: owner,
      createBackup: owner,
    },
  };
}

export async function createSupabaseBackup(actor) {
  if (actor?.role !== 'owner') throw new UserInputError('僅主要管理者可建立備份');

  const [contractors, workers, managers, auditLogs] = await Promise.all([
    supabaseSelect('contractors', {
      select: 'id,name,company_type,status,created_at,archived_at',
      order: 'created_at.asc',
    }),
    supabaseSelect('workers', {
      select: 'id,name,id_number,phone,emergency_contact,emergency_phone,blood_type,job_title,contractor_id,contractor_name,entry_date,notes,photo_storage_path,photo_file_id,created_at,status,deleted_at,updated_at,submission_id,consented_at,source,created_by_id,created_by_name',
      order: 'created_at.asc',
    }),
    supabaseSelect('managers', {
      select: 'id,username,display_name,email,role,contractor_id,contractor_name,status,must_change_password,created_at,updated_at,last_login_at',
      order: 'created_at.asc',
    }),
    supabaseSelect('audit_logs', {
      select: 'id,timestamp,actor_id,actor_role,actor_contractor_id,action,target_type,target_id,details',
      order: 'timestamp.asc',
    }),
  ]);

  const generatedAt = new Date().toISOString();
  const snapshot = {
    format: '施工人員名冊 Supabase 快照 v1',
    generatedAt,
    source: 'supabase',
    note: '管理者密碼雜湊未放入快照；照片以 photo_storage_path 對應私有 worker-photos 儲存空間。',
    contractors,
    workers,
    managers,
    auditLogs,
  };
  const serialized = JSON.stringify(snapshot);
  const bytes = Buffer.from(serialized, 'utf8');
  if (bytes.length > MAX_BACKUP_BYTES) {
    throw new UserInputError('目前資料量超過單一備份檔限制，請改用分批備份');
  }

  await supabaseEnsurePrivateBucket(BACKUP_BUCKET, {
    fileSizeLimit: MAX_BACKUP_BYTES,
    allowedMimeTypes: ['application/json'],
  });
  const stamp = generatedAt.replace(/[-:TZ.]/g, '').slice(0, 14);
  const path = `snapshots/${stamp}_${randomUUID()}.json`;
  await supabaseUploadObject(BACKUP_BUCKET, path, bytes, 'application/json; charset=utf-8');
  const url = await supabaseCreateSignedObjectUrl(BACKUP_BUCKET, path, BACKUP_LINK_TTL_SECONDS);
  return {
    fileId: path,
    name: `施工人員名冊_Supabase快照_${stamp}.json`,
    url,
    expiresAt: new Date(Date.now() + BACKUP_LINK_TTL_SECONDS * 1000).toISOString(),
    source: 'supabase',
    counts: {
      contractors: contractors.length,
      workers: workers.length,
      managers: managers.length,
      auditLogs: auditLogs.length,
    },
  };
}

export async function createWorkerInSupabase(input, actor, source) {
  const contractorId = actor?.role === 'contractor'
    ? actor.contractorId
    : requireText(input.contractorId, '所屬承包商', 100);
  const normalized = validateWorkerInput(input, true);
  const submissionId = String(input.submissionId || '').trim() || randomUUID();
  const [contractor, existingSubmissionRows] = await Promise.all([
    getActiveContractor(contractorId),
    supabaseSelect('workers', {
      select: 'id',
      submission_id: `eq.${submissionId}`,
      limit: '1',
    }),
  ]);
  if (!contractor) throw new UserInputError('所選承包商不存在或已停用');
  if (existingSubmissionRows[0]) {
    return { receiptId: existingSubmissionRows[0].id, duplicate: true };
  }

  await assertNoDuplicateWorker(normalized, contractor.id);
  const photo = parsePhoto(input.photo);
  const now = new Date().toISOString();
  const workerId = randomUUID();
  const photoPath = `${contractor.id}/${workerId}${photo.extension}`;
  let photoUploaded = false;
  try {
    await supabaseUploadPhoto(photoPath, photo.bytes, photo.contentType);
    photoUploaded = true;
    await supabaseInsert('workers', workerRowFromInput(normalized, {
      id: workerId,
      contractor,
      source,
      submissionId,
      now,
      photoStoragePath: photoPath,
      actor,
    }), { returnRepresentation: false });
  } catch (error) {
    if (photoUploaded) {
      try { await supabaseDeletePhoto(photoPath); } catch (cleanupError) { console.warn(cleanupError.message); }
    }
    throw normalizeSupabaseWriteError(error);
  }

  await writeAudit(actor, 'create', 'worker', workerId, contractor.name);
  return { receiptId: workerId, createdAt: now };
}

export async function updateWorkerInSupabase(input, actor) {
  const id = requireText(input.id, '人員 ID', 100);
  const existingRows = await supabaseSelect('workers', {
    select: 'id,contractor_id,contractor_name,source,submission_id,photo_storage_path,photo_file_id,consented_at,created_at,created_by_id,created_by_name',
    id: `eq.${id}`,
    status: 'eq.active',
    limit: '1',
  });
  const existing = existingRows[0];
  if (!existing) throw new UserInputError('找不到人員資料');
  assertWorkerAccess(existing, actor);

  const contractorId = actor.role === 'contractor'
    ? actor.contractorId
    : requireText(input.contractorId, '所屬承包商', 100);
  const normalized = validateWorkerInput(input, false);
  const [contractor, duplicateCheck] = await Promise.all([
    getActiveContractor(contractorId),
    assertNoDuplicateWorker(normalized, contractorId, id),
  ]);
  if (!contractor) throw new UserInputError('所選承包商不存在或已停用');

  const now = new Date().toISOString();
  let newPhotoPath = '';
  let newPhotoUploaded = false;
  try {
    await duplicateCheck;
    if (input.photo) {
      const photo = parsePhoto(input.photo);
      newPhotoPath = `${contractor.id}/${id}${photo.extension}`;
      await supabaseUploadPhoto(newPhotoPath, photo.bytes, photo.contentType);
      newPhotoUploaded = true;
    }

    const changes = workerRowFromInput(normalized, {
      id,
      contractor,
      source: existing.source || 'manager',
      submissionId: existing.submission_id,
      now,
      photoStoragePath: newPhotoPath || existing.photo_storage_path || null,
      photoFileId: existing.photo_file_id || null,
      actor,
      createdAt: existing.created_at,
      createdById: existing.created_by_id,
      createdByName: existing.created_by_name,
    });
    // Preserve the original consent timestamp when an admin edits unrelated fields.
    changes.consented_at = existing.consented_at || changes.consented_at;
    await supabaseUpdate('workers', { id: `eq.${id}` }, changes);
    if (newPhotoPath && existing.photo_storage_path && existing.photo_storage_path !== newPhotoPath) {
      try { await supabaseDeletePhoto(existing.photo_storage_path); } catch (cleanupError) { console.warn(cleanupError.message); }
    }
  } catch (error) {
    if (newPhotoUploaded) {
      try { await supabaseDeletePhoto(newPhotoPath); } catch (cleanupError) { console.warn(cleanupError.message); }
    }
    throw normalizeSupabaseWriteError(error);
  }

  await writeAudit(actor, 'update', 'worker', id, contractor.name);
  return { id, updatedAt: now };
}

export async function deleteWorkerInSupabase(input, actor) {
  const id = requireText(input.id, '人員 ID', 100);
  const filters = {
    id: `eq.${id}`,
    status: 'eq.active',
  };
  if (actor.role === 'contractor') filters.contractor_id = `eq.${actor.contractorId}`;
  const rows = await supabaseUpdate('workers', filters, {
    status: 'deleted',
    deleted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const worker = rows[0];
  if (!worker) throw new UserInputError('找不到人員資料或無權存取');
  await writeAudit(actor, 'archive', 'worker', id, worker.contractor_name);
  return { id };
}

export async function getWorkerPhotoFromSupabase(input, actor) {
  const id = requireText(input.id, '人員 ID', 100);
  const rows = await supabaseSelect('workers', {
    select: 'id,contractor_id,photo_storage_path,photo_file_id',
    id: `eq.${id}`,
    status: 'eq.active',
    limit: '1',
  });
  const worker = rows[0];
  if (!worker) throw new UserInputError('找不到人員資料');
  assertWorkerAccess(worker, actor);
  if (worker.photo_storage_path) {
    const photo = await supabaseDownloadPhoto(worker.photo_storage_path);
    if (photo.bytes.length > MAX_PREVIEW_BYTES) throw new UserInputError('照片檔案過大，無法在後台預覽');
    return {
      dataUrl: `data:${photo.contentType};base64,${photo.bytes.toString('base64')}`,
    };
  }
  if (worker.photo_file_id) return { legacy: true };
  throw new UserInputError('此人員沒有照片');
}

export async function generateReportFromSupabase(input, actor, callGas) {
  const type = String(input.type || '');
  if (type !== 'daily' && type !== 'company') throw new UserInputError('報表類型不正確');
  const date = type === 'daily' ? requireDate(input.date, '報表日期') : '';
  const workerParams = { status: 'eq.active', order: 'created_at.desc' };
  if (actor.role === 'contractor') workerParams.contractor_id = `eq.${actor.contractorId}`;
  const [contractorRows, workerRows] = await Promise.all([
    supabaseSelect('contractors', {
      select: 'id,name,company_type,status,created_at',
      status: 'eq.active',
      order: 'company_type.asc,name.asc',
    }),
    supabaseSelect('workers', {
      select: 'id,name,id_number,phone,emergency_contact,emergency_phone,blood_type,job_title,contractor_id,contractor_name,entry_date,notes,photo_storage_path,photo_file_id,created_at,updated_at',
      ...workerParams,
    }),
  ]);
  const contractors = contractorRows.map(contractorSummaryFromRow).sort(compareContractors);
  const primaryContractor = contractors.find((item) => item.companyType === 'primary') || null;
  if (!primaryContractor) throw new UserInputError('請先設定主承包商公司名稱');

  let workers = workerRows.map((row) => workerForReport(row, contractors));
  let selectedContractor = null;
  if (type === 'daily') {
    workers = workers.filter((worker) => dateKeyTaiwan(worker.createdAt) === date);
  } else {
    const contractorId = actor.role === 'contractor'
      ? actor.contractorId
      : requireText(input.contractorId, '承包商', 100);
    selectedContractor = contractors.find((item) => item.id === contractorId);
    if (!selectedContractor) throw new UserInputError('找不到承包商');
    workers = workers.filter((worker) => worker.contractorId === contractorId);
  }

  workers.sort((left, right) => (
    (left.companyType === 'primary' ? 0 : 1) - (right.companyType === 'primary' ? 0 : 1)
    || String(left.contractorName).localeCompare(String(right.contractorName), 'zh-Hant')
    || String(left.name).localeCompare(String(right.name), 'zh-Hant')
  ));
  const workersWithSignedUrls = await Promise.all(workers.map(async (worker) => {
    if (!worker.photoStoragePath) return worker;
    try {
      return {
        ...worker,
        photoSignedUrl: await supabaseCreateSignedPhotoUrl(worker.photoStoragePath, 300),
      };
    } catch (error) {
      throw new UserInputError(`照片連結產生失敗：${worker.name}`);
    }
  }));

  return callGas('adminGenerateReportFromPayload', {
    type,
    date,
    contractorId: selectedContractor?.id || '',
    primaryContractor,
    contractor: selectedContractor,
    workers: workersWithSignedUrls,
  });
}

export async function syncBundleToSupabase(bundle) {
  if (!bundle || typeof bundle !== 'object') throw new UserInputError('Google 資料格式不正確');
  const contractors = Array.isArray(bundle.contractors) ? bundle.contractors : [];
  const workers = Array.isArray(bundle.workers) ? bundle.workers : [];
  const managers = Array.isArray(bundle.managers) ? bundle.managers : [];
  let contractorCount = 0;
  let workerCount = 0;
  let managerCount = 0;
  const skippedWorkers = [];

  for (const batch of batches(contractors.map(contractorRowFromBundle).filter(Boolean), 100)) {
    if (batch.length) {
      await supabaseUpsert('contractors', batch);
      contractorCount += batch.length;
    }
  }

  const workerRows = workers.map(workerRowFromBundle);
  workers.forEach((worker, index) => {
    if (!workerRows[index]) skippedWorkers.push(String(worker?.id || 'unknown'));
  });
  for (const batch of batches(workerRows.filter(Boolean), 100)) {
    if (!batch.length) continue;
    try {
      await supabaseUpsert('workers', batch);
      workerCount += batch.length;
    } catch (error) {
      if (!(error instanceof SupabaseError && (error.status === 409 || error.code === '23505'))) {
        throw error;
      }
      // Retry conflicting rows individually so one legacy duplicate does not block the rest.
      for (const row of batch) {
        try {
          await supabaseUpsert('workers', row);
          workerCount++;
        } catch (rowError) {
          if (rowError instanceof SupabaseError
            && (rowError.status === 409 || rowError.code === '23505')) {
            skippedWorkers.push(String(row.id || 'unknown'));
            continue;
          }
          throw rowError;
        }
      }
    }
  }

  for (const batch of batches(managers.map(managerRowFromBundle).filter(Boolean), 100)) {
    if (batch.length) {
      await supabaseUpsert('managers', batch);
      managerCount += batch.length;
    }
  }
  return {
    contractors: contractorCount,
    workers: workerCount,
    managers: managerCount,
    skippedWorkers,
  };
}

// Keep the low-frequency Google control-plane actions responsive by mirroring
// only the row changed by the completed action instead of exporting every sheet.
export async function syncActionResultToSupabase(action, result) {
  if (action === 'adminAddContractor' || action === 'adminUpdatePrimaryContractor') {
    const contractor = contractorRowFromBundle(result);
    if (!contractor) throw new UserInputError('承包商資料格式不正確');

    if (action === 'adminUpdatePrimaryContractor') {
      const previousPrimaryRows = await supabaseSelect('contractors', {
        select: 'id',
        company_type: 'eq.primary',
        status: 'eq.active',
      });
      const now = new Date().toISOString();
      await Promise.all([
        ...previousPrimaryRows
          .filter((row) => String(row.id) !== contractor.id)
          .map((row) => supabaseUpdate(
            'contractors',
            { id: `eq.${row.id}` },
            { company_type: 'subcontractor' },
            { returnRepresentation: false },
          )),
        supabaseUpsert('contractors', contractor),
        supabaseUpdate(
          'workers',
          { contractor_id: `eq.${contractor.id}`, status: 'eq.active' },
          { contractor_name: contractor.name, updated_at: now },
          { returnRepresentation: false },
        ),
        supabaseUpdate(
          'managers',
          { contractor_id: `eq.${contractor.id}`, status: 'eq.active' },
          { status: 'disabled', session_version: randomUUID(), updated_at: now },
          { returnRepresentation: false },
        ),
      ]);
    } else {
      await supabaseUpsert('contractors', contractor);
    }
    return { contractors: 1 };
  }

  if (action === 'adminCreateManager') {
    const manager = managerRowFromBundle(result);
    if (!manager) throw new UserInputError('管理者資料格式不正確');
    await supabaseUpsert('managers', manager);
    return { managers: 1 };
  }

  if (action === 'adminArchiveContractor') {
    const contractorId = requireText(result?.id, '承包商 ID', 100);
    const now = new Date().toISOString();
    const [contractorRows] = await Promise.all([
      supabaseUpdate(
        'contractors',
        { id: `eq.${contractorId}`, status: 'eq.active' },
        { status: 'archived', archived_at: now },
      ),
      supabaseUpdate(
        'managers',
        { contractor_id: `eq.${contractorId}`, status: 'eq.active' },
        { status: 'disabled', session_version: randomUUID(), updated_at: now },
        { returnRepresentation: false },
      ),
    ]);
    return contractorRows.length ? { contractors: 1 } : { needsFullSync: true };
  }

  if (action === 'adminResetManagerPassword') {
    const managerId = requireText(result?.id, '管理者 ID', 100);
    const rows = await supabaseUpdate(
      'managers',
      { id: `eq.${managerId}` },
      {
        status: 'active',
        must_change_password: true,
        session_version: randomUUID(),
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      },
    );
    return rows.length ? { managers: 1 } : { needsFullSync: true };
  }

  if (action === 'adminSetManagerStatus') {
    const managerId = requireText(result?.id, '管理者 ID', 100);
    const status = result?.status === 'active' ? 'active' : 'disabled';
    const rows = await supabaseUpdate(
      'managers',
      { id: `eq.${managerId}` },
      {
        status,
        session_version: randomUUID(),
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      },
    );
    return rows.length ? { managers: 1 } : { needsFullSync: true };
  }

  throw new UserInputError('不支援的 Supabase 鏡像操作');
}

export async function assertNoActiveWorkersInSupabase(contractorId) {
  const id = requireText(contractorId, '承包商 ID', 100);
  const rows = await supabaseSelect('workers', {
    contractor_id: `eq.${id}`,
    status: 'eq.active',
    limit: '1',
  });
  if (rows.length) throw new UserInputError('此承包商仍有在冊人員，無法封存');
}

export class UserInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserInputError';
    this.status = 400;
  }
}

async function getActiveContractor(id) {
  const rows = await supabaseSelect('contractors', {
    select: 'id,name,company_type,status',
    id: `eq.${id}`,
    status: 'eq.active',
    limit: '1',
  });
  return rows[0] || null;
}

async function assertNoDuplicateWorker(input, contractorId, excludedId = '') {
  const [idRows, profileRows] = await Promise.all([
    supabaseSelect('workers', {
      select: 'id',
      id_number: `eq.${input.idNumber}`,
      status: 'eq.active',
      limit: '1',
    }),
    supabaseSelect('workers', {
      select: 'id,name,phone',
      contractor_id: `eq.${contractorId}`,
      status: 'eq.active',
    }),
  ]);
  if (idRows[0] && idRows[0].id !== excludedId) {
    throw new UserInputError('此身分證／居留證號已有在冊資料');
  }
  const duplicate = profileRows.find((row) =>
    row.id !== excludedId
    && normalizeText(row.name).toLowerCase() === normalizeText(input.name).toLowerCase()
    && normalizePhone(row.phone) === normalizePhone(input.phone)
  );
  if (duplicate) throw new UserInputError('同包商下已有相同姓名與手機');
}

function workerRowFromInput(input, options) {
  const {
    id,
    contractor,
    source,
    submissionId,
    now,
    photoStoragePath,
    photoFileId = null,
    actor,
    createdAt = now,
    createdById = actor?.id || '',
    createdByName = actor?.displayName || (source === 'public' ? '公開登錄' : ''),
  } = options;
  return {
    id,
    name: input.name,
    id_number: input.idNumber,
    phone: input.phone,
    emergency_contact: input.emergencyContact,
    emergency_phone: input.emergencyPhone,
    blood_type: input.bloodType,
    job_title: input.jobTitle,
    contractor_id: contractor.id,
    contractor_name: contractor.name,
    entry_date: input.entryDate,
    notes: input.notes,
    photo_storage_path: photoStoragePath || null,
    photo_file_id: photoFileId || null,
    created_at: createdAt,
    status: 'active',
    deleted_at: null,
    updated_at: now,
    submission_id: submissionId,
    consented_at: input.consent === true ? now : (input.consentedAt || createdAt),
    source: source || 'manager',
    created_by_id: createdById,
    created_by_name: createdByName,
  };
}

function workerRowFromBundle(worker) {
  if (!worker?.id || !worker.contractorId || !worker.name || !worker.idNumber
    || !worker.phone || !worker.emergencyContact || !worker.emergencyPhone
    || !worker.bloodType || !worker.jobTitle || !worker.entryDate) return null;
  const createdAt = worker.createdAt || new Date().toISOString();
  return {
    id: String(worker.id),
    name: String(worker.name),
    id_number: String(worker.idNumber).toUpperCase(),
    phone: String(worker.phone),
    emergency_contact: String(worker.emergencyContact),
    emergency_phone: String(worker.emergencyPhone),
    blood_type: String(worker.bloodType).toUpperCase(),
    job_title: String(worker.jobTitle),
    contractor_id: String(worker.contractorId),
    contractor_name: String(worker.contractorName || ''),
    entry_date: String(worker.entryDate),
    notes: String(worker.notes || ''),
    photo_storage_path: worker.photoStoragePath || null,
    photo_file_id: worker.photoFileId || null,
    created_at: createdAt,
    status: worker.status === 'deleted' ? 'deleted' : 'active',
    deleted_at: worker.deletedAt || null,
    updated_at: worker.updatedAt || createdAt,
    submission_id: String(worker.submissionId || worker.id),
    consented_at: worker.consentedAt || createdAt,
    source: String(worker.source || 'legacy'),
    created_by_id: String(worker.createdById || ''),
    created_by_name: String(worker.createdByName || ''),
  };
}

function contractorRowFromBundle(contractor) {
  if (!contractor?.id || !contractor.name) return null;
  return {
    id: String(contractor.id),
    name: String(contractor.name),
    company_type: contractor.companyType === 'primary' ? 'primary' : 'subcontractor',
    status: contractor.status === 'archived' ? 'archived' : 'active',
    created_at: contractor.createdAt || new Date().toISOString(),
    archived_at: contractor.archivedAt || null,
  };
}

function managerRowFromBundle(manager) {
  if (!manager?.id || !manager.email || !manager.displayName) return null;
  return {
    id: String(manager.id),
    username: String(manager.username || manager.email).toLowerCase(),
    display_name: String(manager.displayName),
    email: String(manager.email).toLowerCase(),
    role: manager.role === 'owner' ? 'owner' : 'contractor',
    contractor_id: manager.contractorId ? String(manager.contractorId) : null,
    contractor_name: String(manager.contractorName || ''),
    status: manager.status === 'disabled' ? 'disabled' : 'active',
    must_change_password: Boolean(manager.mustChangePassword),
    session_version: String(manager.sessionVersion || randomUUID()),
    failed_attempts: Number(manager.failedAttempts || 0),
    locked_until: manager.lockedUntil || null,
    created_at: manager.createdAt || new Date().toISOString(),
    updated_at: manager.updatedAt || new Date().toISOString(),
    last_login_at: manager.lastLoginAt || null,
  };
}

function batches(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function validateWorkerInput(input, requireConsent) {
  if (!input || typeof input !== 'object') throw new UserInputError('資料格式不正確');
  const result = {
    name: requireText(input.name, '姓名', 60),
    idNumber: validateIdNumber(input.idNumber),
    phone: validatePhone(input.phone, '聯絡電話'),
    emergencyContact: requireText(input.emergencyContact, '緊急聯絡人', 60),
    emergencyPhone: validatePhone(input.emergencyPhone, '緊急聯絡電話'),
    bloodType: requireBloodType(input.bloodType),
    jobTitle: requireText(input.jobTitle, '工作職稱', 80),
    entryDate: requireDate(input.entryDate, '進場日期'),
    notes: optionalText(input.notes, 500),
    consent: input.consent === true,
    consentedAt: input.consentedAt || '',
  };
  if (requireConsent && !result.consent) throw new UserInputError('請確認個資蒐集與使用同意');
  return result;
}

function parsePhoto(value) {
  const source = String(value || '');
  if (source.length > MAX_PHOTO_CHARACTERS) throw new UserInputError('照片檔案過大，請重新裁切後上傳');
  const match = source.match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new UserInputError('照片為必填，且格式必須是 JPG 或 PNG');
  const isPng = match[1].toLowerCase() === 'png';
  const bytes = Buffer.from(match[2], 'base64');
  const validPng = isPng && bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const validJpeg = !isPng && bytes.length >= 3
    && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!validPng && !validJpeg) throw new UserInputError('照片內容不是有效的 JPG 或 PNG');
  return {
    bytes,
    contentType: isPng ? 'image/png' : 'image/jpeg',
    extension: isPng ? '.png' : '.jpg',
  };
}

function validateIdNumber(value) {
  const idNumber = normalizeText(value).toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z][A-Z0-9][0-9]{8}$/.test(idNumber)) throw new UserInputError('身分證／居留證號格式不正確');
  const second = idNumber[1];
  if (/^[0-9]$/.test(second) && !['1', '2', '8', '9'].includes(second)) {
    throw new UserInputError('身分證／居留證號格式不正確');
  }
  const areaCode = TAIWAN_ID_AREA_CODES[idNumber[0]];
  if (!areaCode) throw new UserInputError('身分證／居留證號格式不正確');
  const body = idNumber.slice(1, 9).split('').map((character, index) => (
    index === 0 && /^[A-Z]$/.test(character)
      ? TAIWAN_ID_AREA_CODES[character] % 10
      : Number(character)
  ));
  const digits = [Math.floor(areaCode / 10), areaCode % 10, ...body];
  const weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const sum = digits.reduce((total, digit, index) => total + ((digit * weights[index]) % 10), 0);
  const checkDigit = sum % 10 === 0 ? 0 : 10 - (sum % 10);
  if (checkDigit !== Number(idNumber[9])) throw new UserInputError('身分證／居留證號檢查碼不正確');
  return idNumber;
}

function requireText(value, label, maxLength) {
  const text = normalizeText(value);
  if (!text) throw new UserInputError(`${label}為必填`);
  if (text.length > maxLength) throw new UserInputError(`${label}長度超過限制`);
  return text;
}

function optionalText(value, maxLength) {
  const text = normalizeText(value);
  if (text.length > maxLength) throw new UserInputError('備註長度超過限制');
  return text;
}

function validatePhone(value, label) {
  const phone = requireText(value, label, 30);
  if (!/^[0-9+()\-\s]{7,30}$/.test(phone)) throw new UserInputError(`${label}格式不正確`);
  return phone;
}

function requireBloodType(value) {
  const bloodType = normalizeText(value).toUpperCase();
  if (!['A', 'B', 'AB', 'O'].includes(bloodType)) throw new UserInputError('請選擇血型');
  return bloodType;
}

function requireDate(value, label) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UserInputError(`${label}格式不正確`);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new UserInputError(`${label}格式不正確`);
  }
  return date;
}

function normalizeText(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 10);
  return digits.length === 9 && digits.startsWith('9') ? `0${digits}` : digits;
}

function assertWorkerAccess(worker, actor) {
  if (actor.role === 'contractor' && String(worker.contractor_id) !== String(actor.contractorId)) {
    throw new UserInputError('無權存取其他承包商的人員資料');
  }
}

function contractorSummaryFromRow(row) {
  const companyType = row.company_type === 'primary' ? 'primary' : 'subcontractor';
  return {
    id: String(row.id),
    name: String(row.name || ''),
    companyType,
    levelLabel: companyType === 'primary' ? '主承包商' : '次承包商',
    status: row.status || 'active',
    createdAt: row.created_at || '',
  };
}

function compareContractors(left, right) {
  return (left.companyType === 'primary' ? 0 : 1) - (right.companyType === 'primary' ? 0 : 1)
    || left.name.localeCompare(right.name, 'zh-Hant');
}

function workerSummaryFromRow(row, contractorMap) {
  const contractor = contractorMap[row.contractor_id];
  return {
    id: String(row.id),
    name: row.name,
    idNumber: row.id_number,
    phone: row.phone,
    emergencyContact: row.emergency_contact,
    emergencyPhone: row.emergency_phone,
    bloodType: row.blood_type,
    jobTitle: row.job_title,
    contractorId: row.contractor_id,
    contractorName: row.contractor_name,
    companyType: contractor?.companyType || 'subcontractor',
    companyLevelLabel: contractor?.levelLabel || '次承包商',
    entryDate: row.entry_date,
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasPhoto: Boolean(row.photo_storage_path || row.photo_file_id),
  };
}

function workerForReport(row, contractors) {
  const contractor = contractors.find((item) => item.id === row.contractor_id);
  return {
    id: String(row.id),
    name: row.name,
    idNumber: row.id_number,
    phone: row.phone,
    emergencyContact: row.emergency_contact,
    emergencyPhone: row.emergency_phone,
    bloodType: row.blood_type,
    jobTitle: row.job_title,
    contractorId: row.contractor_id,
    contractorName: row.contractor_name,
    companyType: contractor?.companyType || 'subcontractor',
    entryDate: row.entry_date,
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    photoFileId: row.photo_file_id || '',
    photoStoragePath: row.photo_storage_path || '',
  };
}

function managerFromRow(row) {
  return {
    id: String(row.id),
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    contractorId: row.contractor_id || '',
    contractorName: row.contractor_name || '',
    status: row.status,
    mustChangePassword: Boolean(row.must_change_password),
    sessionVersion: row.session_version || '',
  };
}

function managerProfileFromActor(actor) {
  return {
    id: actor.id,
    username: actor.username,
    displayName: actor.displayName,
    email: actor.email,
    role: actor.role,
    contractorId: actor.contractorId || '',
    contractorName: actor.contractorName || '',
    mustChangePassword: Boolean(actor.mustChangePassword),
  };
}

function managerSummaryFromRow(row) {
  return {
    id: String(row.id),
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    contractorId: row.contractor_id || '',
    contractorName: row.contractor_name || '',
    status: row.status,
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: row.created_at || '',
    lastLoginAt: row.last_login_at || '',
  };
}

async function writeAudit(actor, action, targetType, targetId, details) {
  try {
    await supabaseInsert('audit_logs', {
      actor_id: actor?.id || '',
      actor_role: actor?.role || 'public',
      actor_contractor_id: actor?.contractorId || '',
      action,
      target_type: targetType,
      target_id: targetId,
      details: details || '',
    }, { returnRepresentation: false, timeoutMs: 2500 });
  } catch (error) {
    console.warn(`Supabase 稽核紀錄寫入失敗：${error.message}`);
  }
}

function normalizeSupabaseWriteError(error) {
  if (error instanceof UserInputError) return error;
  if (error instanceof SupabaseError && (error.status === 409 || error.code === '23505')) {
    return new UserInputError('資料已存在，請重新整理後再試');
  }
  return error;
}

function dateKeyTaiwan(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
