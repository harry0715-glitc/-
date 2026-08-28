import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import PDFDocument from 'pdfkit';

import {
  supabaseCreateSignedObjectUrl,
  supabaseDownloadPhoto,
  supabaseEnsurePrivateBucket,
  supabaseUploadObject,
} from './supabase-client.mjs';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const PAGE_MARGIN = 36;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const BODY_BOTTOM = PAGE_HEIGHT - 64;
const MIN_FONT_SIZE = 12;
const PHOTO_WIDTH = 123;
const PHOTO_HEIGHT = 158;
const REPORT_BUCKET = 'registry-reports';
const REPORT_LINK_TTL_SECONDS = 15 * 60;
const MAX_REPORT_BYTES = 20_000_000;
const MAX_PHOTO_BYTES = 2_500_000;
const PHOTO_CONCURRENCY = 4;

const regularFontUrl = new URL('./assets/NotoSansTC-Regular.woff2', import.meta.url);
const boldFontUrl = new URL('./assets/NotoSansTC-Bold.woff2', import.meta.url);
let fontsPromise;
let reportBucketPromise;

export class ReportGenerationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReportGenerationError';
  }
}

async function loadFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      readFile(regularFontUrl),
      readFile(boldFontUrl),
    ]).then(([regular, bold]) => ({ regular, bold }));
  }
  return fontsPromise;
}

async function ensureReportBucket() {
  if (!reportBucketPromise) {
    reportBucketPromise = supabaseEnsurePrivateBucket(REPORT_BUCKET, {
      fileSizeLimit: MAX_REPORT_BYTES,
      allowedMimeTypes: ['application/pdf'],
    }).catch((error) => {
      reportBucketPromise = null;
      throw error;
    });
  }
  return reportBucketPromise;
}

export async function createSupabaseRosterPdf({ report, workers, legacyPhotoLoader = null }) {
  let fonts;
  try {
    fonts = await loadFonts();
  } catch (error) {
    console.error(`PDF 字型載入失敗：${error?.message || error}`);
    throw new ReportGenerationError('PDF 字型載入失敗，請重新部署網站');
  }

  const photos = await loadWorkerPhotos(workers, legacyPhotoLoader);
  const pdfBytes = await renderRosterPdf(report, workers, photos, fonts);
  if (pdfBytes.length > MAX_REPORT_BYTES) {
    throw new ReportGenerationError('PDF 檔案過大，請分公司或分日期產生');
  }

  await ensureReportBucket();
  const filename = `${safeFilename(report.primaryContractorName)}_施工人員名冊_${safeFilename(report.filenameLabel)}.pdf`;
  const stamp = formatTaiwanStamp(new Date());
  const path = `reports/${stamp}_${randomUUID()}.pdf`;
  await supabaseUploadObject(REPORT_BUCKET, path, pdfBytes, 'application/pdf');
  const url = await supabaseCreateSignedObjectUrl(
    REPORT_BUCKET,
    path,
    REPORT_LINK_TTL_SECONDS
  );

  return {
    fileId: path,
    filename,
    url,
    count: workers.length,
    primaryContractorName: report.primaryContractorName,
    scopeLabel: report.scopeLabel,
    source: 'supabase',
  };
}

async function loadWorkerPhotos(workers, legacyPhotoLoader) {
  return mapWithConcurrency(workers, PHOTO_CONCURRENCY, async (worker) => {
    let photo;
    if (worker.photoStoragePath) {
      try {
        photo = await supabaseDownloadPhoto(worker.photoStoragePath);
      } catch (error) {
        throw new ReportGenerationError(`「${worker.name}」的 Supabase 照片讀取失敗，請重新上傳照片`);
      }
    } else if (worker.photoFileId && typeof legacyPhotoLoader === 'function') {
      try {
        photo = await legacyPhotoLoader(worker);
      } catch (error) {
        if (error instanceof ReportGenerationError) throw error;
        throw new ReportGenerationError(`「${worker.name}」的舊照片讀取失敗，請重新上傳照片`);
      }
    } else {
      throw new ReportGenerationError(
        `「${worker.name}」沒有 Supabase 照片，請在後台重新上傳照片`
      );
    }

    if (!photo || !Buffer.isBuffer(photo.bytes)) {
      throw new ReportGenerationError(`「${worker.name}」的照片資料不完整，請重新上傳照片`);
    }
    if (photo.bytes.length > MAX_PHOTO_BYTES) {
      throw new ReportGenerationError(`「${worker.name}」的照片檔案過大，請重新裁切後上傳`);
    }
    if (!/^image\/(jpeg|jpg|png)$/i.test(photo.contentType || '')) {
      throw new ReportGenerationError(`「${worker.name}」的照片格式不支援`);
    }
    return photo.bytes;
  });
}

export function photoFromDataUrl(value) {
  const source = String(value || '');
  const match = source.match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new ReportGenerationError('舊照片格式不支援，請重新上傳照片');

  const isPng = match[1].toLowerCase() === 'png';
  const bytes = Buffer.from(match[2], 'base64');
  const validPng = isPng && bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const validJpeg = !isPng && bytes.length >= 3
    && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!validPng && !validJpeg) {
    throw new ReportGenerationError('舊照片內容無效，請重新上傳照片');
  }
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new ReportGenerationError('舊照片檔案過大，請重新裁切後上傳');
  }
  return {
    bytes,
    contentType: isPng ? 'image/png' : 'image/jpeg',
  };
}

async function mapWithConcurrency(items, limit, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await callback(items[index], index);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(limit, Math.max(1, items.length)) },
    () => worker()
  ));
  return results;
}

async function renderRosterPdf(report, workers, photos, fonts) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAGE_WIDTH, PAGE_HEIGHT],
      margin: 0,
      compress: true,
      autoFirstPage: false,
      font: fonts.regular,
    });
    const chunks = [];
    let pageNumber = 0;
    let y = 0;

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      const startPage = () => {
        doc.addPage({ size: [PAGE_WIDTH, PAGE_HEIGHT], margin: 0 });
        pageNumber += 1;
        drawHeader(doc, report, fonts);
        y = 88;
      };

      startPage();
      y = drawMetadata(doc, report, workers.length, y, fonts) + 12;

      if (!workers.length) {
        doc.font(fonts.regular)
          .fontSize(MIN_FONT_SIZE)
          .fillColor('#71717A')
          .text('此篩選條件目前無人員資料。', PAGE_MARGIN, y + 24, {
            width: CONTENT_WIDTH,
            align: 'center',
            lineGap: 0,
          });
      } else {
        workers.forEach((worker, index) => {
          const title = `${index + 1}. ${worker.name}｜${worker.jobTitle}`;
          const block = measureWorkerBlock(doc, worker, fonts);
          if (y + block.titleHeight + 4 + block.rowHeight + 8 > BODY_BOTTOM && y > 110) {
            drawFooter(doc, pageNumber, fonts);
            startPage();
          }

          doc.font(fonts.bold)
            .fontSize(14)
            .fillColor('#202124')
            .text(title, PAGE_MARGIN, y, {
              width: CONTENT_WIDTH,
              lineGap: 0,
            });
          y += block.titleHeight + 4;
          drawWorker(doc, worker, photos[index], y, block, fonts);
          y += block.rowHeight + 8;
        });
      }

      drawFooter(doc, pageNumber, fonts);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function drawHeader(doc, report, fonts) {
  doc.font(fonts.bold)
    .fontSize(15)
    .fillColor('#202124')
    .text(`主承包商：${report.primaryContractorName}`, PAGE_MARGIN, 28, {
      width: CONTENT_WIDTH,
      align: 'center',
      lineGap: 0,
    });
  doc.font(fonts.bold)
    .fontSize(13)
    .fillColor('#C2410C')
    .text(`施工人員名冊｜${report.reportName}`, PAGE_MARGIN, 51, {
      width: CONTENT_WIDTH,
      align: 'center',
      lineGap: 0,
    });
}

function drawFooter(doc, pageNumber, fonts) {
  const generatedAt = formatTaiwanDateTime(new Date());
  doc.font(fonts.regular)
    .fontSize(MIN_FONT_SIZE)
    .fillColor('#71717A')
    .text(
      `機密文件｜個人資料，僅供本案管理與業主審查使用｜產製：${generatedAt}｜第 ${pageNumber} 頁`,
      PAGE_MARGIN,
      PAGE_HEIGHT - 34,
      { width: CONTENT_WIDTH, align: 'center', lineGap: 0 }
    );
}

function drawMetadata(doc, report, count, y, fonts) {
  const rows = [
    ['報表範圍', report.scopeLabel],
    ['資料基準', report.dataBasis],
    ['人員筆數', String(count)],
  ];
  const labelWidth = 92;
  const valueWidth = CONTENT_WIDTH - labelWidth;
  const heights = rows.map(([, value]) => {
    doc.font(fonts.regular).fontSize(MIN_FONT_SIZE);
    return Math.max(27, doc.heightOfString(String(value || '—'), {
      width: valueWidth - 12,
      lineGap: 0,
    }) + 10);
  });

  let currentY = y;
  rows.forEach(([label, value], index) => {
    const rowHeight = heights[index];
    doc.save().fillColor('#F4F4F5').rect(PAGE_MARGIN, currentY, labelWidth, rowHeight).fill().restore();
    doc.lineWidth(0.75).strokeColor('#D4D4D8').rect(
      PAGE_MARGIN,
      currentY,
      CONTENT_WIDTH,
      rowHeight
    ).stroke();
    doc.moveTo(PAGE_MARGIN + labelWidth, currentY)
      .lineTo(PAGE_MARGIN + labelWidth, currentY + rowHeight)
      .stroke();
    doc.font(fonts.bold)
      .fontSize(MIN_FONT_SIZE)
      .fillColor('#202124')
      .text(label, PAGE_MARGIN + 6, currentY + 5, {
        width: labelWidth - 12,
        lineGap: 0,
      });
    doc.font(fonts.regular)
      .fontSize(MIN_FONT_SIZE)
      .fillColor('#202124')
      .text(String(value || '—'), PAGE_MARGIN + labelWidth + 6, currentY + 5, {
        width: valueWidth - 12,
        lineGap: 0,
      });
    currentY += rowHeight;
  });
  return currentY;
}

function measureWorkerBlock(doc, worker, fonts) {
  doc.font(fonts.bold).fontSize(14);
  const titleHeight = doc.heightOfString(`${worker.name}｜${worker.jobTitle}`, {
    width: CONTENT_WIDTH,
    lineGap: 0,
  });
  const details = workerDetails(worker);
  const detailWidth = CONTENT_WIDTH - PHOTO_WIDTH - 11;
  let detailHeight = 4;
  details.forEach((item) => {
    doc.font(item.bold ? fonts.bold : fonts.regular).fontSize(MIN_FONT_SIZE);
    detailHeight += doc.heightOfString(item.text, {
      width: detailWidth,
      lineGap: 0,
    });
  });
  return {
    titleHeight,
    rowHeight: Math.max(PHOTO_HEIGHT, detailHeight),
    details,
    detailWidth,
  };
}

function drawWorker(doc, worker, photoBytes, y, block, fonts) {
  const photoX = PAGE_MARGIN;
  const detailsX = PAGE_MARGIN + PHOTO_WIDTH;
  const detailTextX = detailsX + 7;
  const rowHeight = block.rowHeight;

  doc.lineWidth(0.75).strokeColor('#A1A1AA').rect(
    PAGE_MARGIN,
    y,
    CONTENT_WIDTH,
    rowHeight
  ).stroke();
  doc.image(photoBytes, photoX, y, {
    width: PHOTO_WIDTH,
    height: rowHeight,
  });
  doc.moveTo(detailsX, y).lineTo(detailsX, y + rowHeight).stroke();

  let detailY = y + 2;
  block.details.forEach((item) => {
    doc.font(item.bold ? fonts.bold : fonts.regular)
      .fontSize(MIN_FONT_SIZE)
      .fillColor('#202124')
      .text(item.text, detailTextX, detailY, {
        width: block.detailWidth,
        lineGap: 0,
      });
    doc.font(item.bold ? fonts.bold : fonts.regular).fontSize(MIN_FONT_SIZE);
    detailY += doc.heightOfString(item.text, {
      width: block.detailWidth,
      lineGap: 0,
    });
  });
}

function workerDetails(worker) {
  return [
    {
      text: `人員類別：${worker.companyType === 'primary' ? '主承包商自有人員' : '次承包商人員'}`,
      bold: true,
    },
    { text: `所屬公司：${display(worker.contractorName)}`, bold: true },
    { text: `身分證／居留證號：${display(worker.idNumber)}` },
    { text: `聯絡電話：${display(worker.phone)}` },
    { text: `血型：${display(worker.bloodType)}` },
    { text: `緊急聯絡人：${display(worker.emergencyContact)}` },
    { text: `緊急聯絡電話：${display(worker.emergencyPhone)}` },
    { text: `進場日期：${display(worker.entryDate)}` },
    { text: `登記時間：${formatTaiwanDateTime(worker.createdAt)}` },
    { text: `最後更新：${formatTaiwanDateTime(worker.updatedAt)}` },
    { text: `備註：${display(worker.notes)}` },
  ];
}

function display(value) {
  const text = String(value == null ? '' : value).trim();
  return text || '—';
}

function formatTaiwanStamp(value) {
  const parts = taiwanParts(value);
  return `${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}${parts.second}`;
}

function formatTaiwanDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return display(value);
  const parts = taiwanParts(date);
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function taiwanParts(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  return Object.fromEntries(parts.map((item) => [item.type, item.value]));
}

function safeFilename(value) {
  return String(value || '報表')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120) || '報表';
}
