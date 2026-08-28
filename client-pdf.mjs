import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 36;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_Y = 27;
const MIN_FONT_SIZE = 12;
const PHOTO_WIDTH = 123;
const ROW_HEIGHT = 180;
const FONT_URL = new URL('./netlify/functions/assets/NotoSansTC-Regular.woff2', import.meta.url);

let fontBytesPromise;

export async function createRosterPdf(report, options = {}) {
  const workers = Array.isArray(report?.workers) ? report.workers : [];
  const photos = Array.isArray(report?.photos) ? report.photos : [];
  if (workers.length !== photos.length) throw new Error('PDF 人員與照片數量不一致');

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontBytes = options.fontBytes || await loadFontBytes();
  const font = await pdf.embedFont(fontBytes, { subset: true });
  let page;
  let y;
  let pageNumber = 0;

  const addPage = (includeMetadata = false) => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pageNumber += 1;
    drawHeader(page, report, font);
    y = PAGE_HEIGHT - 91;
    if (includeMetadata) y = drawMetadata(page, report, workers.length, y, font) - 12;
  };

  addPage(true);
  if (!workers.length) {
    drawCentered(page, '此篩選條件目前無人員資料。', y - 28, 12, font, rgb(0.44, 0.44, 0.48));
  }

  for (let index = 0; index < workers.length; index += 1) {
    if (y - ROW_HEIGHT < 58) {
      drawFooter(page, pageNumber, font);
      addPage(false);
    }
    const photo = await embedPhoto(pdf, photos[index], workers[index]?.name);
    drawWorker(page, workers[index], photo, index + 1, y, font);
    y -= ROW_HEIGHT + 18;
  }

  drawFooter(page, pageNumber, font);
  const bytes = await pdf.save({ useObjectStreams: true });
  return new Blob([bytes], { type: 'application/pdf' });
}

async function loadFontBytes() {
  if (!fontBytesPromise) {
    fontBytesPromise = fetch(FONT_URL).then(async (response) => {
      if (!response.ok) throw new Error('PDF 中文字型載入失敗');
      return new Uint8Array(await response.arrayBuffer());
    }).catch((error) => {
      fontBytesPromise = null;
      throw error;
    });
  }
  return fontBytesPromise;
}

async function embedPhoto(pdf, dataUrl, workerName) {
  const match = String(dataUrl || '').match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error(`「${workerName || '未命名人員'}」的照片格式不正確`);
  const bytes = base64Bytes(match[2]);
  try {
    return match[1].toLowerCase() === 'png'
      ? await pdf.embedPng(bytes)
      : await pdf.embedJpg(bytes);
  } catch {
    throw new Error(`「${workerName || '未命名人員'}」的照片無法加入 PDF`);
  }
}

function base64Bytes(value) {
  if (typeof atob === 'function') {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

function drawHeader(page, report, font) {
  drawCentered(page, `主承包商：${display(report.primaryContractorName)}`, PAGE_HEIGHT - 43, 15, font, rgb(0.12, 0.13, 0.14));
  drawCentered(page, `施工人員名冊｜${display(report.reportName)}`, PAGE_HEIGHT - 66, 13, font, rgb(0.76, 0.25, 0.05));
}

function drawFooter(page, pageNumber, font) {
  const text = `機密文件｜個人資料，僅供本案管理與業主審查使用｜產製：${formatTaiwanDateTime(new Date())}｜第 ${pageNumber} 頁`;
  drawCentered(page, text, FOOTER_Y, MIN_FONT_SIZE, font, rgb(0.44, 0.44, 0.48));
}

function drawMetadata(page, report, count, topY, font) {
  const rows = [
    ['報表範圍', display(report.scopeLabel)],
    ['資料基準', display(report.dataBasis)],
    ['人員筆數', String(count)],
  ];
  const labelWidth = 92;
  const rowHeight = 29;
  let currentTop = topY;
  rows.forEach(([label, value]) => {
    const bottom = currentTop - rowHeight;
    page.drawRectangle({ x: MARGIN, y: bottom, width: labelWidth, height: rowHeight, color: rgb(0.96, 0.96, 0.97) });
    page.drawRectangle({ x: MARGIN, y: bottom, width: CONTENT_WIDTH, height: rowHeight, borderColor: rgb(0.83, 0.83, 0.85), borderWidth: 0.75 });
    page.drawLine({ start: { x: MARGIN + labelWidth, y: bottom }, end: { x: MARGIN + labelWidth, y: currentTop }, thickness: 0.75, color: rgb(0.83, 0.83, 0.85) });
    page.drawText(label, { x: MARGIN + 6, y: bottom + 8, size: MIN_FONT_SIZE, font, color: rgb(0.12, 0.13, 0.14) });
    page.drawText(value, { x: MARGIN + labelWidth + 6, y: bottom + 8, size: MIN_FONT_SIZE, font, color: rgb(0.12, 0.13, 0.14), maxWidth: CONTENT_WIDTH - labelWidth - 12 });
    currentTop = bottom;
  });
  return currentTop;
}

function drawWorker(page, worker, photo, number, topY, font) {
  const titleY = topY - 15;
  page.drawText(`${number}. ${display(worker.name)}｜${display(worker.jobTitle)}`, {
    x: MARGIN,
    y: titleY,
    size: 14,
    font,
    color: rgb(0.12, 0.13, 0.14),
    maxWidth: CONTENT_WIDTH,
  });

  const rowTop = topY - 26;
  const rowBottom = rowTop - ROW_HEIGHT;
  const detailsX = MARGIN + PHOTO_WIDTH;
  page.drawRectangle({ x: MARGIN, y: rowBottom, width: CONTENT_WIDTH, height: ROW_HEIGHT, borderColor: rgb(0.63, 0.63, 0.67), borderWidth: 0.75 });
  page.drawImage(photo, { x: MARGIN, y: rowBottom, width: PHOTO_WIDTH, height: ROW_HEIGHT });
  page.drawLine({ start: { x: detailsX, y: rowBottom }, end: { x: detailsX, y: rowTop }, thickness: 0.75, color: rgb(0.63, 0.63, 0.67) });

  const details = workerDetails(worker);
  const textX = detailsX + 7;
  const textWidth = CONTENT_WIDTH - PHOTO_WIDTH - 14;
  let textY = rowTop - 15;
  details.forEach((text) => {
    const lines = wrapText(text, font, MIN_FONT_SIZE, textWidth);
    lines.forEach((line) => {
      page.drawText(line, { x: textX, y: textY, size: MIN_FONT_SIZE, font, color: rgb(0.12, 0.13, 0.14) });
      textY -= 14.6;
    });
  });
}

function workerDetails(worker) {
  return [
    `人員類別：${worker.companyType === 'primary' ? '主承包商自有人員' : '次承包商人員'}`,
    `所屬公司：${display(worker.contractorName)}`,
    `身分證／居留證號：${display(worker.idNumber)}`,
    `聯絡電話：${display(worker.phone)}`,
    `血型：${display(worker.bloodType)}`,
    `緊急聯絡人：${display(worker.emergencyContact)}`,
    `緊急聯絡電話：${display(worker.emergencyPhone)}`,
    `進場日期：${display(worker.entryDate)}`,
    `登記時間：${formatTaiwanDateTime(worker.createdAt)}`,
    `最後更新：${formatTaiwanDateTime(worker.updatedAt)}`,
    `備註：${display(worker.notes)}`,
  ];
}

function wrapText(text, font, size, maxWidth) {
  const lines = [];
  let current = '';
  for (const character of String(text)) {
    const candidate = current + character;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : ['—'];
}

function drawCentered(page, text, y, size, font, color) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: Math.max(MARGIN, (PAGE_WIDTH - width) / 2), y, size, font, color, maxWidth: CONTENT_WIDTH });
}

function display(value) {
  const text = String(value == null ? '' : value).trim();
  return text || '—';
}

function formatTaiwanDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return display(value);
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}
