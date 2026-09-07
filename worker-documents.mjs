export const PRIMARY_CONTRACTOR_LEGAL_NAME = '楓根室內裝修設計有限公司';
export const DOCUMENT_TEMPLATE_VERSION = 'worker-onboarding-v3';

export const WORKER_DOCUMENTS = Object.freeze([
  {
    id: 'privacy',
    title: '個人資料蒐集、處理及利用同意書',
    shortTitle: '個資同意書',
    pdfUrl: '/forms/privacy-consent-v1.pdf',
    previewUrl: '/forms/privacy-consent-v1.png',
  },
  {
    id: 'health',
    title: '承攬商勞工健康承諾書（SLD-28）',
    shortTitle: '勞工健康承諾書',
    pdfUrl: '/forms/health-commitment-sld28-v1.pdf',
    previewUrl: '/forms/health-commitment-sld28-v1.png',
  },
  {
    id: 'safety',
    title: '承攬商勞工進場安全紀律承諾書（SLD-27）',
    shortTitle: '進場安全紀律承諾書',
    pdfUrl: '/forms/safety-discipline-sld27-v1.pdf',
    previewUrl: '/forms/safety-discipline-sld27-v1.png',
  },
]);

export const HEALTH_CONDITIONS = Object.freeze([
  ['cardiovascular', '心血管疾病'],
  ['hypertension', '高血壓'],
  ['heart', '心臟病'],
  ['anemia', '貧血'],
  ['blood', '血液疾病'],
  ['peripheral_circulation', '周邊循環系統疾病'],
  ['respiratory', '呼吸系統疾病'],
  ['tuberculosis', '肺結核'],
  ['asthma', '氣喘'],
  ['hearing', '聽力異常'],
  ['balance', '平衡機能異常'],
  ['eye', '眼睛疾病'],
  ['retina_vitreous', '視網膜玻璃體疾病'],
  ['musculoskeletal', '骨骼肌肉系統疾病'],
  ['infectious_skin', '傳染性皮膚疾病'],
  ['limb_disability', '肢體殘障'],
  ['nervous_system', '神經系統疾病'],
  ['epilepsy', '癲癇'],
  ['endocrine', '內分泌系統疾病'],
  ['diabetes', '糖尿病'],
  ['kidney', '腎臟疾病'],
  ['digestive', '消化系統疾病'],
  ['alcohol', '酒精中毒'],
  ['mental', '精神疾病'],
  ['malignant_tumor', '惡性腫瘤'],
  ['statutory_infectious', '國內法定傳染病'],
].map(([id, label]) => Object.freeze({ id, label })));

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const OVERLAY_SCALE = 2;
const PACKET_MAX_BYTES = 2_500_000;
const FORM_FONT_URL = new URL('./netlify/functions/assets/NotoSansTC-Regular.woff2', import.meta.url);
let formFontPromise;
let templatePromise;
let pdfLibPromise;

export function createEmptyDocumentState() {
  return {
    documents: Object.fromEntries(WORKER_DOCUMENTS.map(({ id }) => [id, {
      viewedAt: '',
      acceptedAt: '',
      accepted: false,
    }])),
    health: { mode: 'none', conditions: [], other: '' },
    signatureDataUrl: '',
    signedAt: '',
  };
}

export function validateDocumentState(state) {
  const missing = WORKER_DOCUMENTS.filter(({ id }) => (
    !state?.documents?.[id]?.viewedAt || state.documents[id].accepted !== true
  ));
  if (missing.length) return `請閱讀並勾選「${missing[0].shortTitle}」`;
  if (state?.health?.mode === 'declared'
    && !state.health.conditions?.length
    && !String(state.health.other || '').trim()) {
    return '請選擇健康狀況，或填寫其他疾病';
  }
  if (!state?.signatureDataUrl || !state?.signedAt) return '請完成本人手寫簽名';
  return '';
}

export function createDocumentAcceptance(state) {
  const error = validateDocumentState(state);
  if (error) throw new Error(error);
  return {
    templateVersion: DOCUMENT_TEMPLATE_VERSION,
    signedAt: new Date(state.signedAt).toISOString(),
    documents: Object.fromEntries(WORKER_DOCUMENTS.map(({ id }) => {
      const item = state.documents[id];
      return [id, {
        viewedAt: new Date(item.viewedAt).toISOString(),
        acceptedAt: new Date(item.acceptedAt).toISOString(),
        accepted: true,
      }];
    })),
  };
}

export async function createWorkerDocumentPacket({
  worker,
  contractorName,
  contractorCompanyType,
  documentState,
  templateBytes,
}) {
  const stateError = validateDocumentState(documentState);
  if (stateError) throw new Error(stateError);
  if (!String(worker?.name || '').trim()) throw new Error('請先填寫姓名');
  if (!String(worker?.phone || '').trim()) throw new Error('請先填寫聯絡電話');
  if (!String(worker?.jobTitle || '').trim()) throw new Error('請先填寫工作職稱');

  await ensureFormFont();
  const sources = templateBytes || await loadTemplates();
  if (!Array.isArray(sources) || sources.length !== WORKER_DOCUMENTS.length) {
    throw new Error('三份文件範本載入不完整');
  }

  const { PDFDocument } = await loadPdfLib();
  const packet = await PDFDocument.create();
  const signedAt = new Date(documentState.signedAt);
  const values = {
    worker,
    serviceContractorName: String(contractorName || worker.contractorName || '').trim(),
    subcontractorName: contractorCompanyType === 'primary'
      ? ''
      : String(contractorName || worker.contractorName || '').trim(),
    signatureDataUrl: documentState.signatureDataUrl,
    health: documentState.health,
    signedAt,
  };

  for (let index = 0; index < sources.length; index += 1) {
    const source = await PDFDocument.load(sources[index]);
    const [page] = await packet.copyPages(source, [0]);
    packet.addPage(page);
    const overlayBytes = await createOverlay(index, values);
    const overlay = await packet.embedPng(overlayBytes);
    page.drawImage(overlay, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  }

  packet.setTitle(`${worker.name} 施工人員簽署文件`);
  packet.setSubject('個資同意書、勞工健康承諾書、進場安全紀律承諾書');
  packet.setCreator('施工人員名冊系統');
  packet.setProducer('施工人員名冊系統');
  packet.setCreationDate(signedAt);
  packet.setModificationDate(signedAt);
  const bytes = await packet.save({ useObjectStreams: true });
  if (bytes.length > PACKET_MAX_BYTES) throw new Error('簽署文件檔案過大，請清除簽名後重新簽署');
  return new Blob([bytes], { type: 'application/pdf' });
}

export async function mergeRosterAndDocumentPackets(rosterBlob, packetBlobs) {
  const { PDFDocument } = await loadPdfLib();
  const output = await PDFDocument.create();
  let index = 0;
  for (const blob of [rosterBlob, ...(packetBlobs || [])]) {
    const source = await PDFDocument.load(await blob.arrayBuffer());
    if (index > 0 && source.getPageCount() !== 3) throw new Error('簽署文件頁數不完整，已停止匯出');
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
    index += 1;
  }
  const bytes = await output.save({ useObjectStreams: true });
  return new Blob([bytes], { type: 'application/pdf' });
}

function loadPdfLib() {
  if (!pdfLibPromise) pdfLibPromise = import('pdf-lib');
  return pdfLibPromise;
}

export async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

export function dataUrlToBlob(dataUrl, expectedType = 'application/pdf') {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[1].toLowerCase() !== expectedType.toLowerCase()) {
    throw new Error('簽署文件回傳格式不正確');
  }
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1] });
}

async function loadTemplates() {
  if (!templatePromise) {
    templatePromise = Promise.all(WORKER_DOCUMENTS.map(async ({ pdfUrl }) => {
      const response = await fetch(pdfUrl, { cache: 'force-cache' });
      if (!response.ok) throw new Error('文件範本載入失敗，請重新整理後再試');
      return new Uint8Array(await response.arrayBuffer());
    })).catch((error) => {
      templatePromise = null;
      throw error;
    });
  }
  return templatePromise;
}

async function ensureFormFont() {
  if (typeof FontFace === 'undefined' || !globalThis.document?.fonts) return;
  if (!formFontPromise) {
    formFontPromise = new FontFace('WorkerFormNoto', `url(${FORM_FONT_URL.href})`)
      .load()
      .then((font) => {
        document.fonts.add(font);
        return font;
      })
      .catch((error) => {
        formFontPromise = null;
        throw new Error(`文件中文字型載入失敗：${error.message}`);
      });
  }
  await formFontPromise;
}

async function createOverlay(index, values) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(PAGE_WIDTH * OVERLAY_SCALE);
  canvas.height = Math.round(PAGE_HEIGHT * OVERLAY_SCALE);
  const context = canvas.getContext('2d');
  context.scale(OVERLAY_SCALE, OVERLAY_SCALE);
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#111111';
  context.strokeStyle = '#111111';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.font = '12px WorkerFormNoto, "Microsoft JhengHei", sans-serif';

  if (index === 0) await drawPrivacyOverlay(context, values);
  if (index === 1) await drawHealthOverlay(context, values);
  if (index === 2) await drawSafetyOverlay(context, values);
  return canvasToBytes(canvas);
}

async function drawPrivacyOverlay(context, values) {
  drawFittedText(context, values.serviceContractorName, 130, 748, 138, 11);
  drawFittedText(context, values.worker.phone, 130, 766, 138, 11);
  drawDateParts(context, values.signedAt, { yearX: 346, monthX: 394, dayX: 436, y: 766 });
  await drawSignature(context, values.signatureDataUrl, 342, 711, 110, 35);
}

async function drawHealthOverlay(context, values) {
  drawFittedText(context, PRIMARY_CONTRACTOR_LEGAL_NAME, 156, 156, 121);
  drawFittedText(context, values.subcontractorName, 341, 156, 177);
  drawFittedText(context, values.worker.name, 156, 182, 360);
  drawFittedText(context, values.worker.jobTitle, 156, 211, 360);

  const selected = new Set(values.health?.conditions || []);
  HEALTH_CONDITIONS.forEach(({ id }, index) => {
    const column = index < 13 ? 0 : 1;
    const row = column ? index - 13 : index;
    const y = 287.5 + row * 28.85;
    const hasX = column ? 339.5 : 102;
    const noneX = column ? 363.5 : 126;
    drawCheck(context, selected.has(id) ? hasX : noneX, y);
  });
  if (values.health?.mode !== 'declared') drawCheck(context, 119, 692);
  drawCheck(context, String(values.health?.other || '').trim() ? 102 : 126, 662.5);
  drawFittedText(context, values.health?.other || '', 289, 657, 226, 10.5);
  await drawSignature(context, values.signatureDataUrl, 160, 708, 175, 30);
  drawDateText(context, values.signedAt, 411, 724, 110, 10.5);
}

async function drawSafetyOverlay(context, values) {
  drawFittedText(context, PRIMARY_CONTRACTOR_LEGAL_NAME, 157, 158, 121);
  drawFittedText(context, values.subcontractorName, 341, 158, 177);
  drawFittedText(context, values.worker.name, 157, 184, 360);
  drawFittedText(context, values.worker.jobTitle, 157, 213, 360);
  await drawSignature(context, values.signatureDataUrl, 160, 658, 175, 32);
  drawDateText(context, values.signedAt, 142, 717, 150, 10.5);
}

function drawFittedText(context, value, x, y, maxWidth, initialSize = 12) {
  const text = String(value || '').trim();
  if (!text) return;
  const size = Math.max(12, initialSize);
  context.font = `${size}px WorkerFormNoto, "Microsoft JhengHei", sans-serif`;
  let lines = [''];
  for (const character of text) {
    const last = lines.length - 1;
    if (context.measureText(lines[last] + character).width > maxWidth) lines.push(character);
    else lines[last] += character;
  }
  if (lines.length > 2) throw new Error(`欄位內容過長，請縮短後再簽署：${text}`);
  if (lines.length === 2) {
    const middle = Math.ceil(text.length / 2);
    const balanced = [text.slice(0, middle), text.slice(middle)];
    if (balanced.every((line) => context.measureText(line).width <= maxWidth)) lines = balanced;
  }
  lines.forEach((line, index) => context.fillText(line, x, y - (lines.length - 1 - index) * 13));
}

function drawCheck(context, x, y) {
  context.save();
  context.strokeStyle = '#111111';
  context.lineWidth = 1.2;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + 2, y + 2);
  context.lineTo(x + 5, y - 3);
  context.stroke();
  context.restore();
}

function drawDateParts(context, value, { yearX, monthX, dayX, y }) {
  const parts = taiwanDateParts(value);
  drawFittedText(context, parts.year, yearX, y, 33, 10.5);
  drawFittedText(context, parts.month, monthX, y, 22, 10.5);
  drawFittedText(context, parts.day, dayX, y, 22, 10.5);
}

function drawDateText(context, value, x, y, maxWidth, size) {
  const parts = taiwanDateParts(value);
  drawFittedText(context, `${parts.year}年${parts.month}月${parts.day}日`, x, y, maxWidth, size);
}

function taiwanDateParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { year: '', month: '', day: '' };
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value || '';
  return { year: read('year'), month: read('month'), day: read('day') };
}

async function drawSignature(context, dataUrl, x, y, width, height) {
  const image = await loadImage(dataUrl);
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('手寫簽名無法讀取，請重新簽名'));
    image.src = src;
  });
}

function canvasToBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('簽署文件無法產生，請重新操作'));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });
}
