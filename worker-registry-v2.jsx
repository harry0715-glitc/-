import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Building2,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  ClipboardCopy,
  DatabaseBackup,
  Download,
  Eye,
  EyeOff,
  FileText,
  HardHat,
  Image as ImageIcon,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X
} from 'lucide-react';

const PUBLIC_ENDPOINT = '/api/public';
const ADMIN_ENDPOINT = '/api/admin';
const SESSION_EXPIRED = 'SESSION_EXPIRED';
const TAIWAN_ID_AREA_CODES = {
  A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17,
  I: 34, J: 18, K: 19, L: 20, M: 21, N: 22, O: 35, P: 23,
  Q: 24, R: 25, S: 26, T: 27, U: 28, V: 29, W: 32, X: 30,
  Y: 31, Z: 33
};

const withTimeout = async (url, options = {}, timeoutMs = 20000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('連線逾時，請稍後再試');
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const readJson = async (response) => {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('伺服器回應格式不正確');
  }
  if (!response.ok || !body.ok) {
    const error = new Error(body.error || '操作失敗');
    if (response.status === 401) error.code = SESSION_EXPIRED;
    throw error;
  }
  return body.data;
};

const API = {
  async publicConfig() {
    const response = await withTimeout(PUBLIC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getPublicConfig', payload: {} }),
      cache: 'no-store'
    });
    return readJson(response);
  },

  async submitRegistration(payload) {
    const response = await withTimeout(PUBLIC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'submitRegistration', payload })
    }, 30000);
    return readJson(response);
  },

  async admin(action, payload = {}) {
    const response = await withTimeout(ADMIN_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload })
    }, action === 'adminGenerateReport' ? 90000 : 30000);
    return readJson(response);
  }
};

const todayKey = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const contractorLevelLabel = (contractor) =>
  contractor?.companyType === 'primary' ? '主承包商' : '次承包商';

const contractorOptionLabel = (contractor) =>
  `${contractorLevelLabel(contractor)}｜${contractor.name}`;

const newSubmissionId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const isValidTaiwanIdNumber = (value) => {
  const idNumber = String(value || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9][0-9]{8}$/.test(idNumber)) return false;
  const second = idNumber[1];
  if (/^[0-9]$/.test(second) && !['1', '2', '8', '9'].includes(second)) return false;

  const areaCode = TAIWAN_ID_AREA_CODES[idNumber[0]];
  const body = idNumber.slice(1, 9).split('').map((character, index) =>
    index === 0 && /^[A-Z]$/.test(character)
      ? TAIWAN_ID_AREA_CODES[character] % 10
      : Number(character)
  );
  const digits = [Math.floor(areaCode / 10), areaCode % 10, ...body];
  const weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const sum = digits.reduce((total, digit, index) =>
    total + ((digit * weights[index]) % 10), 0
  );
  const checkDigit = sum % 10 === 0 ? 0 : 10 - (sum % 10);
  return checkDigit === Number(idNumber[9]);
};

const emptyWorker = (contractorId = '') => ({
  name: '',
  idNumber: '',
  phone: '',
  emergencyContact: '',
  emergencyPhone: '',
  bloodType: '',
  jobTitle: '',
  contractorId,
  entryDate: todayKey(),
  notes: '',
  consent: false,
  submissionId: newSubmissionId()
});

const validateWorker = (form, hasPhoto, consentRequired) => {
  const errors = {};
  if (!form.name.trim()) errors.name = '請填寫姓名';
  if (!form.idNumber.trim()) {
    errors.idNumber = '請填寫身分證／居留證號';
  } else if (!/^[A-Za-z][A-Za-z0-9][0-9]{8}$/.test(form.idNumber.trim())) {
    errors.idNumber = '請輸入 10 碼身分證或居留證號';
  } else if (!isValidTaiwanIdNumber(form.idNumber)) {
    errors.idNumber = '證號格式或檢查碼不正確';
  }
  if (!form.phone.trim()) {
    errors.phone = '請填寫聯絡電話';
  } else if (!/^[0-9+()\-\s]{7,30}$/.test(form.phone.trim())) {
    errors.phone = '聯絡電話格式不正確';
  }
  if (!form.emergencyContact.trim()) errors.emergencyContact = '請填寫緊急聯絡人';
  if (!form.emergencyPhone.trim()) {
    errors.emergencyPhone = '請填寫緊急聯絡電話';
  } else if (!/^[0-9+()\-\s]{7,30}$/.test(form.emergencyPhone.trim())) {
    errors.emergencyPhone = '緊急聯絡電話格式不正確';
  }
  if (!form.bloodType) errors.bloodType = '請選擇血型';
  if (!form.jobTitle.trim()) errors.jobTitle = '請填寫工作職稱';
  if (!form.contractorId) errors.contractorId = '請選擇所屬承包商';
  if (!form.entryDate) errors.entryDate = '請選擇進場日期';
  if (!hasPhoto) errors.photo = '請拍照或上傳照片';
  if (consentRequired && !form.consent) errors.consent = '需確認個資蒐集與使用同意';
  return errors;
};

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-TW');
};

const generateTemporaryPassword = () => {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = letters + digits + '!@#$%';
  const random = new Uint32Array(16);
  crypto.getRandomValues(random);
  const chars = Array.from(random, (value) => all[value % all.length]);
  chars[0] = letters[random[0] % letters.length];
  chars[1] = digits[random[1] % digits.length];
  return chars.join('');
};

const isInAppBrowser = () =>
  /Line|FBAN|FBAV|Instagram|Messenger|MicroMessenger/i.test(navigator.userAgent || '');

const readImageFile = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const cropImage = (src, crop, preview, outW = 420, outH = 540, quality = 0.84) =>
  new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const context = canvas.getContext('2d');
      const previewWidth = preview?.width || outW;
      const previewHeight = preview?.height || outH;
      const cover = Math.max(outW / image.width, outH / image.height);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, outW, outH);
      context.save();
      context.translate(
        outW / 2 + crop.x * outW / previewWidth,
        outH / 2 + crop.y * outH / previewHeight
      );
      context.scale(cover * crop.scale, cover * crop.scale);
      context.drawImage(image, -image.width / 2, -image.height / 2);
      context.restore();
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    image.onerror = reject;
    image.src = src;
  });

const clampCrop = (next, metrics) => {
  const scale = Math.max(1, Math.min(3.5, Number(next.scale) || 1));
  if (!metrics) return { scale, x: 0, y: 0 };
  const maxX = Math.max(0, (metrics.baseWidth * scale - metrics.frameWidth) / 2);
  const maxY = Math.max(0, (metrics.baseHeight * scale - metrics.frameHeight) / 2);
  return {
    scale,
    x: Math.max(-maxX, Math.min(maxX, Number(next.x) || 0)),
    y: Math.max(-maxY, Math.min(maxY, Number(next.y) || 0))
  };
};

const inputClass = (error) =>
  `w-full rounded-lg border bg-zinc-900 px-3.5 py-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-orange-500 ${error ? 'border-red-500' : 'border-zinc-700'}`;

function Field({ label, required, error, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-zinc-300">
        {label}
        {required && <span className="ml-1 text-orange-400" aria-hidden="true">*</span>}
      </span>
      {children}
      {error && (
        <span className="mt-1.5 flex items-center gap-1 text-xs text-red-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </span>
      )}
    </label>
  );
}

function Toast({ toast }) {
  return (
    <div
      aria-live="polite"
      className={`fixed left-1/2 top-4 z-[80] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 transition-all ${toast.visible ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0 pointer-events-none'}`}
    >
      <div className={`flex items-start gap-2 rounded-lg px-4 py-3 text-sm font-semibold shadow-2xl ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>
        {toast.type === 'error'
          ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          : <Check className="mt-0.5 h-4 w-4 shrink-0" />}
        <span>{toast.message}</span>
      </div>
    </div>
  );
}

function CameraOpenHelp({ open, onClose, showToast }) {
  if (!open) return null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      showToast('網址已複製，請貼到 Chrome 或 Safari 開啟');
    } catch {
      showToast('請長按網址複製，再用外部瀏覽器開啟', 'error');
    }
  };

  const openExternal = () => {
    const href = location.href;
    if (/Android/i.test(navigator.userAgent) && /^https?:\/\//.test(href)) {
      const scheme = location.protocol.replace(':', '');
      const cleanUrl = href.replace(/^https?:\/\//, '');
      location.href = `intent://${cleanUrl}#Intent;scheme=${scheme};action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end`;
      return;
    }
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-sm rounded-lg border border-amber-500/40 bg-zinc-950 p-5 shadow-2xl">
        <AlertTriangle className="mb-4 h-9 w-9 text-amber-400" />
        <h2 className="text-xl font-black text-white">相機沒有開啟</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          {isInAppBrowser()
            ? 'LINE 等內建瀏覽器可能限制相機。請改用手機的 Chrome 或 Safari。'
            : '請確認瀏覽器的相機權限，或改用外部瀏覽器開啟。'}
        </p>
        <div className="mt-5 grid gap-2">
          <button onClick={openExternal} className="rounded-lg bg-orange-600 px-4 py-3 font-bold text-white">
            用外部瀏覽器開啟
          </button>
          <button onClick={copyLink} className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 font-bold text-zinc-200">
            複製連結
          </button>
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-500">返回</button>
        </div>
      </div>
    </div>
  );
}

function PhotoCropper({ src, onCancel, onDone, showToast }) {
  const [crop, setCrop] = useState({ scale: 1.08, x: 0, y: 0 });
  const [metrics, setMetrics] = useState(null);
  const frameRef = useRef(null);
  const gestureRef = useRef(null);

  const measureImage = (naturalWidth, naturalHeight) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect?.height || !naturalWidth || !naturalHeight) return;
    const cover = Math.max(rect.width / naturalWidth, rect.height / naturalHeight);
    const nextMetrics = {
      naturalWidth,
      naturalHeight,
      frameWidth: rect.width,
      frameHeight: rect.height,
      baseWidth: naturalWidth * cover,
      baseHeight: naturalHeight * cover
    };
    setMetrics(nextMetrics);
    setCrop((current) => clampCrop(current, nextMetrics));
  };

  useEffect(() => {
    if (!metrics?.naturalWidth || !metrics?.naturalHeight) return undefined;
    const handleResize = () => measureImage(metrics.naturalWidth, metrics.naturalHeight);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [metrics?.naturalHeight, metrics?.naturalWidth]);
  const distance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const midpoint = (a, b) => ({
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2
  });

  const startGesture = (event) => {
    if (event.touches?.length >= 2) {
      const center = midpoint(event.touches[0], event.touches[1]);
      gestureRef.current = {
        type: 'pinch',
        distance: distance(event.touches[0], event.touches[1]),
        centerX: center.x,
        centerY: center.y,
        ...crop
      };
      return;
    }
    const point = event.touches?.[0] || event;
    gestureRef.current = {
      type: 'pan',
      pointX: point.clientX,
      pointY: point.clientY,
      x: crop.x,
      y: crop.y
    };
  };

  const moveGesture = (event) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (event.cancelable) event.preventDefault();

    if (event.touches?.length >= 2 && gesture.type === 'pinch') {
      const center = midpoint(event.touches[0], event.touches[1]);
      const ratio = distance(event.touches[0], event.touches[1]) / Math.max(1, gesture.distance);
      setCrop(clampCrop({
        scale: gesture.scale * ratio,
        x: gesture.x + center.x - gesture.centerX,
        y: gesture.y + center.y - gesture.centerY
      }, metrics));
      return;
    }
    const point = event.touches?.[0] || event;
    setCrop(clampCrop({
      ...crop,
      x: gesture.x + point.clientX - gesture.pointX,
      y: gesture.y + point.clientY - gesture.pointY
    }, metrics));
  };

  const finish = async () => {
    try {
      const rect = frameRef.current?.getBoundingClientRect();
      onDone(await cropImage(src, crop, rect));
      showToast('照片已裁切');
    } catch {
      showToast('照片裁切失敗，請重新選取', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-zinc-950">
      <header className="border-b border-zinc-800 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button onClick={onCancel} className="mb-3 flex items-center gap-1.5 text-sm text-zinc-400">
          <ArrowLeft className="h-4 w-4" />
          取消
        </button>
        <h2 className="text-xl font-black text-white">裁切人員照片</h2>
        <p className="mt-1 text-xs text-zinc-500">2 吋照片比例 3.5 × 4.5 cm</p>
      </header>

      <div className="flex flex-1 items-center justify-center overflow-hidden px-4 py-5">
        <div className="w-full max-w-[310px]">
          <div
            ref={frameRef}
            className="relative aspect-[7/9] w-full touch-none cursor-grab overflow-hidden rounded-lg bg-zinc-900 active:cursor-grabbing"
            onMouseDown={startGesture}
            onMouseMove={moveGesture}
            onMouseUp={() => { gestureRef.current = null; }}
            onMouseLeave={() => { gestureRef.current = null; }}
            onWheel={(event) => {
              event.preventDefault();
              setCrop((current) => clampCrop({
                ...current,
                scale: current.scale + (event.deltaY > 0 ? -0.07 : 0.07)
              }, metrics));
            }}
            onTouchStart={startGesture}
            onTouchMove={moveGesture}
            onTouchEnd={() => { gestureRef.current = null; }}
            onTouchCancel={() => { gestureRef.current = null; }}
          >
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <img
                src={src}
                alt="照片裁切預覽"
                draggable="false"
                onLoad={(event) => measureImage(
                  event.currentTarget.naturalWidth,
                  event.currentTarget.naturalHeight
                )}
                className="max-w-none select-none"
                style={{
                  width: metrics ? `${metrics.baseWidth}px` : '100%',
                  height: metrics ? `${metrics.baseHeight}px` : '100%',
                  objectFit: metrics ? 'fill' : 'cover',
                  transform: `translate(${crop.x}px, ${crop.y}px) scale(${crop.scale})`,
                  transformOrigin: 'center'
                }}
              />
            </div>
            <div className="pointer-events-none absolute inset-0 border-2 border-white/90" />
            <div className="pointer-events-none absolute inset-[4%] border border-dashed border-white/60" />
            <div className="pointer-events-none absolute left-1/2 top-[8%] h-[76%] aspect-[8/9] -translate-x-1/2 rounded-[48%] border-2 border-dashed border-white/90" />
            <div className="pointer-events-none absolute left-[14%] right-[14%] top-[8%] border-t border-dashed border-white/50" />
            <div className="pointer-events-none absolute left-[14%] right-[14%] top-[84%] border-t border-dashed border-white/50" />
            <div className="pointer-events-none absolute left-[18%] right-[18%] top-[70%] border-t border-dashed border-white/40" />
            <div className="pointer-events-none absolute left-1/2 top-[8%] h-[76%] border-l border-dashed border-white/35" />
          </div>
          <p className="mt-3 text-center text-xs text-zinc-500">拖曳照片；兩指縮放，將頭頂與下巴對齊虛線</p>
        </div>
      </div>

      <footer className="border-t border-zinc-800 bg-zinc-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button onClick={finish} className="flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-3.5 font-bold text-white">
          <Check className="h-5 w-5" />
          確認裁切
        </button>
      </footer>
    </div>
  );
}

function PhotoPicker({ preview, onPreview, onPhoto, onClear, canClear = true, error, showToast }) {
  const [cropSource, setCropSource] = useState('');
  const [cameraHelp, setCameraHelp] = useState(false);
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const attemptRef = useRef(0);

  const handleFile = async (event) => {
    attemptRef.current = 0;
    setCameraHelp(false);
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('請選擇圖片檔', 'error');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showToast('原始照片不可超過 15 MB', 'error');
      return;
    }
    try {
      setCropSource(await readImageFile(file));
    } catch {
      showToast('無法讀取照片，請重新選取', 'error');
    }
  };

  const openCamera = () => {
    const input = cameraRef.current;
    if (!input) {
      setCameraHelp(true);
      return;
    }
    const attempt = Date.now();
    let pickerOpened = false;
    attemptRef.current = attempt;
    const markOpened = () => { pickerOpened = true; };
    const markHidden = () => {
      if (document.visibilityState === 'hidden') pickerOpened = true;
    };
    window.addEventListener('blur', markOpened, { once: true });
    document.addEventListener('visibilitychange', markHidden);
    try {
      input.click();
    } catch {
      setCameraHelp(true);
      return;
    }
    setTimeout(() => {
      window.removeEventListener('blur', markOpened);
      document.removeEventListener('visibilitychange', markHidden);
      if (attemptRef.current === attempt && !pickerOpened && document.visibilityState === 'visible') {
        setCameraHelp(true);
      }
    }, 900);
  };

  return (
    <>
      <CameraOpenHelp open={cameraHelp} onClose={() => setCameraHelp(false)} showToast={showToast} />
      {cropSource && (
        <PhotoCropper
          src={cropSource}
          showToast={showToast}
          onCancel={() => setCropSource('')}
          onDone={(cropped) => {
            onPhoto(cropped);
            onPreview(cropped);
            setCropSource('');
          }}
        />
      )}
      <section className={`rounded-lg border bg-zinc-950 p-4 ${error ? 'border-red-500' : 'border-zinc-800'}`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold text-white">人員照片 <span className="text-orange-400">*</span></h3>
          <span className="text-xs text-zinc-500">3.5 × 4.5 cm</span>
        </div>
        <div className="flex items-start gap-4">
          <div className="flex aspect-[7/9] w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900">
            {preview
              ? <img src={preview} alt="人員照片預覽" className="h-full w-full object-cover" />
              : <Users className="h-9 w-9 text-zinc-700" />}
          </div>
          <div className="grid flex-1 gap-2">
            <input ref={cameraRef} type="file" accept="image/*" capture="user" className="hidden" onChange={handleFile} />
            <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
            <button type="button" onClick={openCamera} className="flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-3 py-2.5 text-sm font-bold text-white">
              <Camera className="h-4 w-4" />
              拍照
            </button>
            <button type="button" onClick={() => galleryRef.current?.click()} className="flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm font-semibold text-zinc-200">
              <ImageIcon className="h-4 w-4" />
              從相簿選取
            </button>
            {preview && canClear && (
              <button
                type="button"
                onClick={onClear}
                className="flex items-center justify-center gap-1 px-2 py-1 text-xs text-zinc-500"
              >
                <X className="h-3.5 w-3.5" />
                移除照片
              </button>
            )}
          </div>
        </div>
        {error && <p className="mt-2 flex items-center gap-1 text-xs text-red-400"><AlertTriangle className="h-3.5 w-3.5" />{error}</p>}
      </section>
    </>
  );
}

function WorkerForm({
  initial,
  contractors,
  lockedContractorId,
  initialPhoto = '',
  existingPhoto = false,
  consentRequired = true,
  submitLabel,
  saving,
  onSubmit,
  onCancel,
  showToast
}) {
  const [form, setForm] = useState(() => ({ ...emptyWorker(lockedContractorId), ...initial }));
  const [newPhoto, setNewPhoto] = useState('');
  const [preview, setPreview] = useState(initialPhoto);
  const [errors, setErrors] = useState({});
  const formRef = useRef(null);

  useEffect(() => {
    if (!newPhoto) setPreview(initialPhoto);
  }, [initialPhoto, newPhoto]);

  const setValue = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const normalized = {
      ...form,
      contractorId: lockedContractorId || form.contractorId,
      idNumber: form.idNumber.trim().toUpperCase()
    };
    const nextErrors = validateWorker(
      normalized,
      Boolean(newPhoto || existingPhoto),
      consentRequired
    );
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      requestAnimationFrame(() => {
        formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
      });
      showToast('尚有必填資料未完成', 'error');
      return;
    }
    await onSubmit({ ...normalized, photo: newPhoto || undefined });
  };

  const invalid = (key) => Boolean(errors[key]);
  return (
    <form ref={formRef} onSubmit={submit} className="space-y-4">
      <PhotoPicker
        preview={preview}
        onPreview={setPreview}
        onPhoto={(value) => {
          setNewPhoto(value);
          setErrors((current) => ({ ...current, photo: undefined }));
        }}
        canClear={Boolean(newPhoto) || !existingPhoto}
        onClear={() => {
          setNewPhoto('');
          setPreview(existingPhoto ? initialPhoto : '');
          setErrors((current) => ({ ...current, photo: undefined }));
        }}
        error={errors.photo}
        showToast={showToast}
      />

      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h3 className="mb-4 font-bold text-white">基本資料</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="姓名" required error={errors.name}>
            <input
              aria-invalid={invalid('name')}
              autoComplete="name"
              className={inputClass(errors.name)}
              value={form.name}
              onChange={(event) => setValue('name', event.target.value)}
            />
          </Field>
          <Field label="身分證／居留證號" required error={errors.idNumber}>
            <input
              aria-invalid={invalid('idNumber')}
              autoCapitalize="characters"
              className={inputClass(errors.idNumber)}
              value={form.idNumber}
              onChange={(event) => setValue('idNumber', event.target.value.toUpperCase())}
            />
          </Field>
          <Field label="聯絡電話" required error={errors.phone}>
            <input
              aria-invalid={invalid('phone')}
              autoComplete="tel"
              inputMode="tel"
              className={inputClass(errors.phone)}
              value={form.phone}
              onChange={(event) => setValue('phone', event.target.value)}
            />
          </Field>
          <Field label="血型" required error={errors.bloodType}>
            <select
              aria-invalid={invalid('bloodType')}
              className={inputClass(errors.bloodType)}
              value={form.bloodType}
              onChange={(event) => setValue('bloodType', event.target.value)}
            >
              <option value="">請選擇</option>
              <option value="A">A 型</option>
              <option value="B">B 型</option>
              <option value="AB">AB 型</option>
              <option value="O">O 型</option>
            </select>
          </Field>
          <Field label="緊急聯絡人" required error={errors.emergencyContact}>
            <input
              aria-invalid={invalid('emergencyContact')}
              className={inputClass(errors.emergencyContact)}
              value={form.emergencyContact}
              onChange={(event) => setValue('emergencyContact', event.target.value)}
            />
          </Field>
          <Field label="緊急聯絡電話" required error={errors.emergencyPhone}>
            <input
              aria-invalid={invalid('emergencyPhone')}
              inputMode="tel"
              className={inputClass(errors.emergencyPhone)}
              value={form.emergencyPhone}
              onChange={(event) => setValue('emergencyPhone', event.target.value)}
            />
          </Field>
          <Field label="工作職稱" required error={errors.jobTitle}>
            <input
              aria-invalid={invalid('jobTitle')}
              className={inputClass(errors.jobTitle)}
              value={form.jobTitle}
              onChange={(event) => setValue('jobTitle', event.target.value)}
            />
          </Field>
          <Field label="所屬公司" required error={errors.contractorId}>
            {lockedContractorId ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-3 text-sm text-zinc-300">
                {contractors.find((item) => item.id === lockedContractorId)
                  ? contractorOptionLabel(contractors.find((item) => item.id === lockedContractorId))
                  : '所屬公司'}
              </div>
            ) : (
              <select
                aria-invalid={invalid('contractorId')}
                className={inputClass(errors.contractorId)}
                value={form.contractorId}
                onChange={(event) => setValue('contractorId', event.target.value)}
              >
                <option value="">請選擇</option>
                {contractors.map((contractor) => (
                  <option key={contractor.id} value={contractor.id}>{contractorOptionLabel(contractor)}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="進場日期" required error={errors.entryDate}>
            <input
              aria-invalid={invalid('entryDate')}
              type="date"
              className={inputClass(errors.entryDate)}
              value={form.entryDate}
              onChange={(event) => setValue('entryDate', event.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="備註">
              <textarea
                rows={3}
                maxLength={500}
                className={inputClass()}
                value={form.notes}
                onChange={(event) => setValue('notes', event.target.value)}
              />
            </Field>
          </div>
        </div>
      </section>

      {consentRequired && (
        <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${errors.consent ? 'border-red-500 bg-red-950/20' : 'border-zinc-800 bg-zinc-950'}`}>
          <input
            aria-invalid={invalid('consent')}
            type="checkbox"
            className="mt-0.5 h-5 w-5 accent-orange-600"
            checked={form.consent}
            onChange={(event) => setValue('consent', event.target.checked)}
          />
          <span className="text-sm leading-6 text-zinc-300">
            已確認當事人同意蒐集並使用本表中的身分、聯絡、緊急聯絡、血型及照片資料。
            {errors.consent && <span className="mt-1 block text-xs text-red-400">{errors.consent}</span>}
          </span>
        </label>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-zinc-800 pt-4 sm:flex-row sm:justify-end">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg border border-zinc-700 px-5 py-3 font-semibold text-zinc-300">
            取消
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
        >
          {saving ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
          {saving ? '儲存中' : submitLabel}
        </button>
      </div>
    </form>
  );
}

export default function App() {
  const [view, setView] = useState('loading');
  const [contractors, setContractors] = useState([]);
  const [primaryContractor, setPrimaryContractor] = useState(null);
  const [adminData, setAdminData] = useState(null);
  const [initError, setInitError] = useState('');
  const [toast, setToast] = useState({ message: '', type: 'success', visible: false });
  const toastTimer = useRef(null);

  const showToast = useCallback((message, type = 'success') => {
    clearTimeout(toastTimer.current);
    setToast({ message, type, visible: true });
    toastTimer.current = setTimeout(() => {
      setToast((current) => ({ ...current, visible: false }));
    }, 3500);
  }, []);

  const loadPublic = useCallback(async () => {
    setView('loading');
    setInitError('');
    try {
      const data = await API.publicConfig();
      setContractors(data.contractors || []);
      setPrimaryContractor(data.primaryContractor || null);
      setView('home');
    } catch (error) {
      setInitError(error.message);
      setView('error');
    }
  }, []);

  useEffect(() => {
    loadPublic();
    return () => clearTimeout(toastTimer.current);
  }, [loadPublic]);

  const handleAuthError = useCallback((error) => {
    if (error.code === SESSION_EXPIRED) {
      setAdminData(null);
      setView('adminLogin');
      showToast('管理工作階段已結束，請重新登入', 'error');
      return true;
    }
    return false;
  }, [showToast]);

  const refreshAdmin = useCallback(async () => {
    try {
      const data = await API.admin('adminGetData');
      setAdminData(data);
      return data;
    } catch (error) {
      if (!handleAuthError(error)) throw error;
      return null;
    }
  }, [handleAuthError]);

  const enterAdmin = async () => {
    try {
      const session = await API.admin('adminGetSession');
      if (session.profile.mustChangePassword) {
        setAdminData({ profile: session.profile, primaryContractor: null, contractors: [], workers: [], managers: [] });
      } else {
        await refreshAdmin();
      }
      setView('admin');
    } catch {
      setAdminData(null);
      setView('adminLogin');
    }
  };

  const adminCall = useCallback(async (action, payload, refresh = false) => {
    try {
      const result = await API.admin(action, payload);
      if (refresh) await refreshAdmin();
      return result;
    } catch (error) {
      handleAuthError(error);
      throw error;
    }
  }, [handleAuthError, refreshAdmin]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Toast toast={toast} />
      {view === 'loading' && <LoadingView />}
      {view === 'error' && <ErrorView message={initError} onRetry={loadPublic} />}
      {view === 'home' && (
        <HomeView
          contractors={contractors}
          primaryContractor={primaryContractor}
          onRegister={() => setView('register')}
          onAdmin={enterAdmin}
          onRefresh={loadPublic}
        />
      )}
      {view === 'register' && (
        <RegisterView
          contractors={contractors}
          primaryContractor={primaryContractor}
          showToast={showToast}
          onBack={() => setView('home')}
        />
      )}
      {view === 'adminLogin' && (
        <AdminLoginView
          showToast={showToast}
          onBack={() => setView('home')}
          onSuccess={async (profile) => {
            if (profile.mustChangePassword) {
              setAdminData({ profile, primaryContractor: null, contractors: [], workers: [], managers: [] });
            } else {
              await refreshAdmin();
            }
            setView('admin');
          }}
        />
      )}
      {view === 'admin' && adminData && (
        <AdminView
          data={adminData}
          setData={setAdminData}
          contractors={adminData.contractors || []}
          showToast={showToast}
          adminCall={adminCall}
          refresh={refreshAdmin}
          onHome={() => setView('home')}
          onLogout={async () => {
            try { await API.admin('logout'); } catch { /* Cookie is still cleared client-side by expiry response when available. */ }
            setAdminData(null);
            setView('home');
          }}
        />
      )}
    </div>
  );
}

function LoadingView() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <LoaderCircle className="mx-auto h-9 w-9 animate-spin text-orange-500" />
        <p className="mt-3 text-sm text-zinc-500">正在連線</p>
      </div>
    </div>
  );
}

function ErrorView({ message, onRetry }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-5">
      <div className="w-full max-w-md rounded-lg border border-red-900 bg-zinc-950 p-6 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-red-400" />
        <h1 className="mt-4 text-xl font-black text-white">系統暫時無法使用</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">{message}</p>
        <button onClick={onRetry} className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-3 font-bold text-white">
          <RefreshCw className="h-4 w-4" />
          重新連線
        </button>
      </div>
    </div>
  );
}

function AppHeader({ title, subtitle, onBack, right }) {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center gap-3 px-4 py-3">
        {onBack && (
          <button onClick={onBack} title="返回" aria-label="返回" className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-900 hover:text-white">
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-black text-white">{title}</h1>
          {subtitle && <p className="truncate text-xs text-zinc-500">{subtitle}</p>}
        </div>
        {right}
      </div>
    </header>
  );
}

function HomeView({ contractors, primaryContractor, onRegister, onAdmin, onRefresh }) {
  return (
    <main className="min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 pb-8 pt-[max(2rem,env(safe-area-inset-top))]">
        <header className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-orange-600 text-white">
            <HardHat className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-orange-400">{primaryContractor?.name || '施工人員'}</p>
            <p className="font-black text-white">名冊登錄系統</p>
          </div>
          <button onClick={onRefresh} title="重新整理" aria-label="重新整理" className="ml-auto rounded-lg p-2 text-zinc-500 hover:bg-zinc-900 hover:text-white">
            <RefreshCw className="h-4 w-4" />
          </button>
        </header>

        <section className="flex flex-1 flex-col justify-center py-12">
          <div className="max-w-xl">
            <ShieldCheck className="h-10 w-10 text-emerald-400" />
            <h1 className="mt-5 text-3xl font-black leading-tight text-white sm:text-4xl">
              施工人員資料登錄
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-7 text-zinc-400">
              請備妥個人資料、緊急聯絡資料及正面照片。
            </p>
            <button onClick={onRegister} className="mt-8 flex w-full max-w-md items-center gap-3 rounded-lg bg-orange-600 px-5 py-4 text-left font-bold text-white shadow-lg shadow-orange-950/40">
              <UserPlus className="h-6 w-6" />
              <span className="flex-1">開始填寫人員資料</span>
              <ChevronRight className="h-5 w-5" />
            </button>
            <div className="mt-3 flex max-w-md items-center gap-2 text-xs text-zinc-500">
              <Building2 className="h-4 w-4" />
              目前可選擇 {contractors.length} 家公司
            </div>
          </div>
        </section>

        <footer className="flex items-center justify-between border-t border-zinc-800 pt-5">
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <LockKeyhole className="h-4 w-4" />
            資料採權限控管
          </div>
          <button onClick={onAdmin} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-zinc-400 hover:bg-zinc-900 hover:text-white">
            <Settings className="h-4 w-4" />
            管理登入
          </button>
        </footer>
      </div>
    </main>
  );
}

function RegisterView({ contractors, primaryContractor, showToast, onBack }) {
  const [done, setDone] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formKey, setFormKey] = useState(0);

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center p-5">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10">
            <Check className="h-10 w-10 text-emerald-400" />
          </div>
          <h1 className="mt-5 text-2xl font-black text-white">登錄完成</h1>
          <p className="mt-2 text-sm text-zinc-400">資料已送交所屬承包商管理。</p>
          <p className="mt-3 font-mono text-xs text-zinc-600">收件編號 {done.receiptId}</p>
          <div className="mt-8 grid gap-2">
            <button
              onClick={() => {
                setDone(null);
                setFormKey((value) => value + 1);
              }}
              className="rounded-lg bg-orange-600 px-4 py-3 font-bold text-white"
            >
              繼續登錄下一位
            </button>
            <button onClick={onBack} className="rounded-lg border border-zinc-700 px-4 py-3 font-semibold text-zinc-300">
              返回首頁
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      <AppHeader
        title="人員資料登錄"
        subtitle={primaryContractor?.name ? `主承包商：${primaryContractor.name} · 標示 * 的欄位皆為必填` : '標示 * 的欄位皆為必填'}
        onBack={onBack}
      />
      <main className="mx-auto w-full max-w-3xl px-4 py-5 pb-12">
        <WorkerForm
          key={formKey}
          initial={emptyWorker()}
          contractors={contractors}
          submitLabel="確認送出"
          saving={saving}
          showToast={showToast}
          onCancel={onBack}
          onSubmit={async (payload) => {
            setSaving(true);
            try {
              const result = await API.submitRegistration(payload);
              setDone(result);
              showToast('資料登錄成功');
            } catch (error) {
              showToast(`儲存失敗：${error.message}`, 'error');
            } finally {
              setSaving(false);
            }
          }}
        />
      </main>
    </div>
  );
}

function AdminLoginView({ onBack, onSuccess, showToast }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError('請輸入管理帳號與密碼');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await API.admin('login', { username: username.trim(), password });
      await onSuccess(result.profile);
      showToast('登入成功');
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-5">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-orange-600 text-white">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-2xl font-black text-white">管理登入</h1>
          <p className="mt-1 text-sm text-zinc-500">主要管理者與承包商管理者共用入口</p>
        </div>
        <div className="space-y-4">
          <Field label="管理帳號">
            <input
              type="email"
              autoComplete="username"
              className={inputClass(error)}
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setError('');
              }}
            />
          </Field>
          <Field label="密碼" error={error}>
            <div className="relative">
              <input
                type={visible ? 'text' : 'password'}
                autoComplete="current-password"
                className={`${inputClass(error)} pr-11`}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError('');
                }}
              />
              <button type="button" onClick={() => setVisible((value) => !value)} title={visible ? '隱藏密碼' : '顯示密碼'} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-zinc-500">
                {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
        </div>
        <button type="submit" disabled={saving} className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-3.5 font-bold text-white disabled:bg-zinc-700">
          {saving ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <LockKeyhole className="h-5 w-5" />}
          登入
        </button>
        <button type="button" onClick={onBack} className="mt-2 flex w-full items-center justify-center gap-2 px-4 py-3 text-sm text-zinc-500">
          <ArrowLeft className="h-4 w-4" />
          返回首頁
        </button>
      </form>
    </div>
  );
}

function AdminView({ data, setData, showToast, adminCall, refresh, onHome, onLogout }) {
  const owner = data.profile.role === 'owner';
  const [tab, setTab] = useState('workers');
  const tabs = [
    { id: 'workers', label: '人員', icon: Users },
    ...(owner ? [
      { id: 'contractors', label: '公司', icon: Building2 },
      { id: 'managers', label: '次管理者', icon: ShieldCheck }
    ] : []),
    { id: 'reports', label: '報表', icon: FileText },
    { id: 'settings', label: '帳號', icon: Settings }
  ];

  if (data.profile.mustChangePassword) {
    return (
      <div className="min-h-screen">
        <AppHeader title="更換臨時密碼" subtitle={data.profile.displayName} onBack={onLogout} />
        <main className="mx-auto w-full max-w-lg px-4 py-8">
          <PasswordPanel
            required
            profile={data.profile}
            adminCall={adminCall}
            showToast={showToast}
            onChanged={async (profile) => {
              setData((current) => ({ ...current, profile }));
              await refresh();
            }}
          />
        </main>
      </div>
    );
  }

  const roleLabel = owner
    ? (data.primaryContractor?.name || '主要管理者')
    : data.profile.contractorName;
  return (
    <div className="min-h-screen bg-zinc-950 pb-20">
      <AppHeader
        title="管理後台"
        subtitle={`${data.profile.displayName} · ${roleLabel}`}
        onBack={onHome}
        right={(
          <div className="flex items-center gap-1">
            <button
              onClick={async () => {
                try {
                  if (await refresh()) showToast('資料已重新整理');
                } catch (error) {
                  showToast(`重新整理失敗：${error.message}`, 'error');
                }
              }}
              title="重新整理"
              aria-label="重新整理"
              className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-900 hover:text-white"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button onClick={onLogout} title="登出" aria-label="登出" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-900 hover:text-white">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      />
      <main className="mx-auto w-full max-w-6xl px-4 py-5">
        {tab === 'workers' && (
          <WorkersTab
            data={data}
            showToast={showToast}
            adminCall={adminCall}
            refresh={refresh}
          />
        )}
        {tab === 'contractors' && owner && (
          <ContractorsTab data={data} showToast={showToast} adminCall={adminCall} refresh={refresh} />
        )}
        {tab === 'managers' && owner && (
          <ManagersTab data={data} showToast={showToast} adminCall={adminCall} refresh={refresh} />
        )}
        {tab === 'reports' && (
          <ReportsTab data={data} showToast={showToast} adminCall={adminCall} />
        )}
        {tab === 'settings' && (
          <SettingsTab
            data={data}
            setData={setData}
            showToast={showToast}
            adminCall={adminCall}
            onLogout={onLogout}
          />
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-3xl">
          {tabs.map((item) => {
            const TabIcon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-semibold ${tab === item.id ? 'text-orange-400' : 'text-zinc-600'}`}
              >
                <TabIcon className="h-5 w-5" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function WorkersTab({ data, showToast, adminCall, refresh }) {
  const [search, setSearch] = useState('');
  const [contractorFilter, setContractorFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [photo, setPhoto] = useState('');
  const [photoLoading, setPhotoLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const owner = data.profile.role === 'owner';

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.workers.filter((worker) => {
      const matchesSearch = !needle || [
        worker.name,
        worker.idNumber,
        worker.phone,
        worker.jobTitle,
        worker.contractorName
      ].some((value) => String(value || '').toLowerCase().includes(needle));
      return matchesSearch && (!contractorFilter || worker.contractorId === contractorFilter);
    });
  }, [contractorFilter, data.workers, search]);

  useEffect(() => {
    setPhoto('');
    if (!selected?.hasPhoto) return;
    let active = true;
    setPhotoLoading(true);
    adminCall('adminGetPhoto', { id: selected.id })
      .then((result) => {
        if (active) setPhoto(result.dataUrl);
      })
      .catch((error) => {
        if (active) showToast(`照片讀取失敗：${error.message}`, 'error');
      })
      .finally(() => {
        if (active) setPhotoLoading(false);
      });
    return () => { active = false; };
  }, [adminCall, selected?.id, selected?.hasPhoto, showToast]);

  if (editing) {
    const isNew = editing === 'new';
    const initial = isNew
      ? emptyWorker(owner ? '' : data.profile.contractorId)
      : { ...editing, consent: false };
    return (
      <div>
        <div className="mb-5 flex items-center gap-3">
          <button onClick={() => setEditing(null)} title="返回人員列表" className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-900">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h2 className="text-xl font-black text-white">{isNew ? '新增人員' : '修改人員資料'}</h2>
            <p className="text-xs text-zinc-500">{owner ? '主承包商及全部次承包商' : data.profile.contractorName}</p>
          </div>
        </div>
        <WorkerForm
          initial={initial}
          initialPhoto={isNew ? '' : photo}
          existingPhoto={!isNew && editing.hasPhoto}
          contractors={data.contractors}
          lockedContractorId={owner ? '' : data.profile.contractorId}
          consentRequired={isNew}
          submitLabel={isNew ? '新增人員' : '儲存修改'}
          saving={saving}
          showToast={showToast}
          onCancel={() => setEditing(null)}
          onSubmit={async (payload) => {
            setSaving(true);
            try {
              await adminCall(
                isNew ? 'adminAddWorker' : 'adminUpdateWorker',
                isNew ? payload : { ...payload, id: editing.id }
              );
              await refresh();
              setEditing(null);
              setSelected(null);
              showToast(isNew ? '人員已新增' : '人員資料已更新');
            } catch (error) {
              showToast(`儲存失敗：${error.message}`, 'error');
            } finally {
              setSaving(false);
            }
          }}
        />
      </div>
    );
  }

  if (selected) {
    const rows = [
      ['身分證／居留證號', selected.idNumber],
      ['聯絡電話', selected.phone],
      ['緊急聯絡人', selected.emergencyContact],
      ['緊急聯絡電話', selected.emergencyPhone],
      ['血型', selected.bloodType],
      ['工作職稱', selected.jobTitle],
      ['公司層級', selected.companyLevelLabel || contractorLevelLabel(selected)],
      ['所屬公司', selected.contractorName],
      ['進場日期', selected.entryDate],
      ['備註', selected.notes || '—'],
      ['登記時間', formatDateTime(selected.createdAt)],
      ['最後更新', formatDateTime(selected.updatedAt)]
    ];
    return (
      <div>
        <button onClick={() => setSelected(null)} className="mb-4 flex items-center gap-2 text-sm font-semibold text-orange-400">
          <ArrowLeft className="h-4 w-4" />
          返回人員列表
        </button>
        <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
          <div className="aspect-[7/9] w-full max-w-[220px] overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
            {photoLoading && <LoaderCircle className="mx-auto mt-24 h-7 w-7 animate-spin text-zinc-600" />}
            {!photoLoading && photo && <img src={photo} alt={selected.name} className="h-full w-full object-cover" />}
            {!photoLoading && !photo && <Users className="mx-auto mt-24 h-10 w-10 text-zinc-700" />}
          </div>
          <div>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black text-white">{selected.name}</h2>
                <p className="mt-1 text-sm text-orange-400">{selected.jobTitle}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditing(selected)} className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-bold text-white">
                  <Pencil className="h-4 w-4" />
                  修改
                </button>
                <button
                  onClick={async () => {
                    if (!confirm(`確定封存「${selected.name}」的人員資料？`)) return;
                    try {
                      await adminCall('adminDeleteWorker', { id: selected.id });
                      await refresh();
                      setSelected(null);
                      showToast('人員資料已封存');
                    } catch (error) {
                      showToast(`封存失敗：${error.message}`, 'error');
                    }
                  }}
                  className="flex items-center gap-2 rounded-lg border border-red-900 px-4 py-2.5 text-sm font-bold text-red-400"
                >
                  <Archive className="h-4 w-4" />
                  封存
                </button>
              </div>
            </div>
            <dl className="divide-y divide-zinc-800 border-y border-zinc-800">
              {rows.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[120px_1fr] gap-3 py-3 text-sm">
                  <dt className="text-zinc-500">{label}</dt>
                  <dd className="min-w-0 break-words font-medium text-zinc-200">{value || '—'}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-white">人員名冊</h2>
          <p className="mt-1 text-xs text-zinc-500">共 {data.workers.length} 位在冊人員</p>
        </div>
        <button onClick={() => setEditing('new')} className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-bold text-white">
          <Plus className="h-4 w-4" />
          新增
        </button>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_240px]">
        <label className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
          <input
            className={`${inputClass()} pl-10`}
            placeholder="搜尋姓名、證號、電話或職稱"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {owner && (
          <select className={inputClass()} value={contractorFilter} onChange={(event) => setContractorFilter(event.target.value)}>
            <option value="">全部公司</option>
            {data.contractors.map((contractor) => (
              <option key={contractor.id} value={contractor.id}>{contractorOptionLabel(contractor)}</option>
            ))}
          </select>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-800">
        {filtered.length === 0 ? (
          <div className="py-14 text-center text-sm text-zinc-600">查無人員資料</div>
        ) : filtered.map((worker, index) => (
          <button
            key={worker.id}
            onClick={() => setSelected(worker)}
            className={`flex w-full items-center gap-3 bg-zinc-950 px-4 py-3 text-left hover:bg-zinc-900 ${index ? 'border-t border-zinc-800' : ''}`}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-800 font-black text-orange-400">
              {worker.name.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold text-white">{worker.name}</div>
              <div className="truncate text-xs text-zinc-500">{worker.jobTitle} · {worker.companyLevelLabel || contractorLevelLabel(worker)} · {worker.contractorName}</div>
            </div>
            <div className="hidden text-right text-xs text-zinc-600 sm:block">{worker.entryDate}</div>
            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-700" />
          </button>
        ))}
      </div>
    </div>
  );
}

function ContractorsTab({ data, showToast, adminCall, refresh }) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [primaryName, setPrimaryName] = useState(data.primaryContractor?.name || '');
  const [savingPrimary, setSavingPrimary] = useState(false);
  const subcontractors = data.contractors.filter((contractor) => contractor.companyType !== 'primary');

  useEffect(() => {
    setPrimaryName(data.primaryContractor?.name || '');
  }, [data.primaryContractor?.name]);

  const workerCount = (id) => data.workers.filter((worker) => worker.contractorId === id).length;
  return (
    <div>
      <div className="mb-5">
        <h2 className="text-xl font-black text-white">公司管理</h2>
        <p className="mt-1 text-xs text-zinc-500">1 家主承包商 · {subcontractors.length} 家次承包商</p>
      </div>

      <section className="mb-6 border-y border-zinc-800 py-4">
        <div className="mb-3 flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-orange-400" />
          <div>
            <h3 className="font-bold text-white">主承包商公司名稱</h3>
            <p className="mt-1 text-xs text-zinc-500">由主要管理者管理，並顯示於所有交付業主的 PDF 抬頭</p>
          </div>
        </div>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!primaryName.trim()) return;
            setSavingPrimary(true);
            try {
              await adminCall('adminUpdatePrimaryContractor', { name: primaryName.trim() });
              await refresh();
              showToast('主承包商公司名稱已更新');
            } catch (error) {
              showToast(`更新失敗：${error.message}`, 'error');
            } finally {
              setSavingPrimary(false);
            }
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input required className={inputClass()} placeholder="請輸入主承包商完整公司名稱" value={primaryName} onChange={(event) => setPrimaryName(event.target.value)} />
          <button disabled={savingPrimary} className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-3 font-bold text-white disabled:bg-zinc-700">
            {savingPrimary ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            儲存
          </button>
        </form>
        {data.primaryContractor && (
          <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
            <Building2 className="h-4 w-4" />
            主承包商目前有 {workerCount(data.primaryContractor.id)} 位在冊人員
          </div>
        )}
      </section>

      <div className="mb-3">
        <h3 className="font-bold text-white">次承包商</h3>
        <p className="mt-1 text-xs text-zinc-500">每家次承包商可配發一位次管理者</p>
      </div>

      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!name.trim()) return;
          setAdding(true);
          try {
            await adminCall('adminAddContractor', { name: name.trim() });
            await refresh();
            setName('');
            showToast('次承包商已新增');
          } catch (error) {
            showToast(`新增失敗：${error.message}`, 'error');
          } finally {
            setAdding(false);
          }
        }}
        className="mb-5 flex gap-2"
      >
        <input className={inputClass()} placeholder="次承包商公司名稱" value={name} onChange={(event) => setName(event.target.value)} />
        <button disabled={adding} className="flex shrink-0 items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 font-bold text-white disabled:bg-zinc-700">
          {adding ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          新增
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-zinc-800">
        {subcontractors.length === 0 ? (
          <div className="py-10 text-center text-sm text-zinc-600">尚未新增次承包商</div>
        ) : subcontractors.map((contractor, index) => (
          <div key={contractor.id} className={`flex items-center gap-3 bg-zinc-950 px-4 py-3 ${index ? 'border-t border-zinc-800' : ''}`}>
            <Building2 className="h-5 w-5 shrink-0 text-orange-400" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold text-white">{contractor.name}</p>
              <p className="text-xs text-zinc-500">{workerCount(contractor.id)} 位在冊人員</p>
            </div>
            <button
              title="封存次承包商"
              onClick={async () => {
                if (!confirm(`確定封存「${contractor.name}」？`)) return;
                try {
                  await adminCall('adminArchiveContractor', { id: contractor.id });
                  await refresh();
                  showToast('次承包商已封存');
                } catch (error) {
                  showToast(`封存失敗：${error.message}`, 'error');
                }
              }}
              className="rounded-lg p-2 text-zinc-600 hover:bg-red-950 hover:text-red-400"
            >
              <Archive className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ManagersTab({ data, showToast, adminCall, refresh }) {
  const [creating, setCreating] = useState(false);
  const [resetId, setResetId] = useState('');
  const [issued, setIssued] = useState(null);
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    contractorId: '',
    temporaryPassword: generateTemporaryPassword()
  });
  const subcontractors = data.contractors.filter((contractor) => contractor.companyType !== 'primary');

  const setValue = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('已複製');
    } catch {
      showToast('無法自動複製', 'error');
    }
  };

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-xl font-black text-white">次承包商管理者</h2>
        <p className="mt-1 text-xs text-zinc-500">每家次承包商限一位啟用中的次管理者；主承包商僅由主要管理者管理</p>
      </div>

      {issued && (
        <section className="mb-5 rounded-lg border border-emerald-700 bg-emerald-950/20 p-4">
          <div className="flex items-start gap-3">
            <Check className="mt-0.5 h-5 w-5 text-emerald-400" />
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-white">帳號已建立</h3>
              <p className="mt-2 break-all text-sm text-zinc-300">{issued.email}</p>
              <p className="mt-1 break-all font-mono text-sm text-orange-300">{issued.password}</p>
              <p className="mt-2 text-xs text-zinc-500">交付後請關閉此提示，臨時密碼不會再次顯示。</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button onClick={() => copy(`管理帳號：${issued.email}\n臨時密碼：${issued.password}`)} title="複製帳密" className="rounded-lg p-2 text-emerald-400">
                <ClipboardCopy className="h-5 w-5" />
              </button>
              <button onClick={() => setIssued(null)} title="關閉" className="rounded-lg p-2 text-zinc-500">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </section>
      )}

      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setCreating(true);
          try {
            await adminCall('adminCreateManager', form);
            await refresh();
            setIssued({ email: form.email, password: form.temporaryPassword });
            setForm({
              displayName: '',
              email: '',
              contractorId: '',
              temporaryPassword: generateTemporaryPassword()
            });
            showToast('次管理者帳號已建立');
          } catch (error) {
            showToast(`建立失敗：${error.message}`, 'error');
          } finally {
            setCreating(false);
          }
        }}
        className="mb-6 grid gap-4 rounded-lg border border-zinc-800 p-4 sm:grid-cols-2"
      >
        <Field label="管理者姓名" required>
          <input required className={inputClass()} value={form.displayName} onChange={(event) => setValue('displayName', event.target.value)} />
        </Field>
        <Field label="Google 帳號 Email" required>
          <input required type="email" className={inputClass()} value={form.email} onChange={(event) => setValue('email', event.target.value)} />
        </Field>
        <Field label="所屬次承包商" required>
          <select required className={inputClass()} value={form.contractorId} onChange={(event) => setValue('contractorId', event.target.value)}>
            <option value="">請選擇</option>
            {subcontractors.map((contractor) => (
              <option key={contractor.id} value={contractor.id}>{contractor.name}</option>
            ))}
          </select>
        </Field>
        <Field label="臨時密碼" required>
          <div className="flex gap-2">
            <input required minLength={12} className={`${inputClass()} font-mono`} value={form.temporaryPassword} onChange={(event) => setValue('temporaryPassword', event.target.value)} />
            <button type="button" title="重新產生密碼" onClick={() => setValue('temporaryPassword', generateTemporaryPassword())} className="rounded-lg border border-zinc-700 px-3 text-zinc-400">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </Field>
        <button disabled={creating} className="flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-3 font-bold text-white disabled:bg-zinc-700 sm:col-span-2">
          {creating ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />}
          建立次管理者
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-zinc-800">
        {data.managers.length === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-600">尚未建立次管理者</div>
        ) : data.managers.map((manager, index) => (
          <div key={manager.id} className={`bg-zinc-950 px-4 py-4 ${index ? 'border-t border-zinc-800' : ''}`}>
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-orange-400" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold text-white">{manager.displayName}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${manager.status === 'active' ? 'bg-emerald-950 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
                    {manager.status === 'active' ? '啟用' : '停用'}
                  </span>
                </div>
                <p className="mt-1 break-all text-xs text-zinc-500">{manager.email}</p>
                <p className="mt-1 text-xs text-zinc-500">{manager.contractorName}</p>
                <p className="mt-1 text-[11px] text-zinc-700">最近登入 {formatDateTime(manager.lastLoginAt)}</p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setResetId(resetId === manager.id ? '' : manager.id)} title="重設密碼" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-900 hover:text-orange-400">
                  <KeyRound className="h-4 w-4" />
                </button>
                <button
                  onClick={async () => {
                    const nextStatus = manager.status === 'active' ? 'disabled' : 'active';
                    if (!confirm(`確定${nextStatus === 'active' ? '啟用' : '停用'}此帳號？`)) return;
                    try {
                      await adminCall('adminSetManagerStatus', { id: manager.id, status: nextStatus });
                      await refresh();
                      showToast('帳號狀態已更新');
                    } catch (error) {
                      showToast(`更新失敗：${error.message}`, 'error');
                    }
                  }}
                  title={manager.status === 'active' ? '停用帳號' : '啟用帳號'}
                  className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-900 hover:text-red-400"
                >
                  {manager.status === 'active' ? <Trash2 className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {resetId === manager.id && (
              <ResetPasswordForm
                manager={manager}
                adminCall={adminCall}
                showToast={showToast}
                onDone={async (password) => {
                  await refresh();
                  setIssued({ email: manager.email, password });
                  setResetId('');
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResetPasswordForm({ manager, adminCall, showToast, onDone }) {
  const [password, setPassword] = useState(generateTemporaryPassword());
  const [saving, setSaving] = useState(false);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        try {
          await adminCall('adminResetManagerPassword', {
            id: manager.id,
            temporaryPassword: password
          });
          await onDone(password);
          showToast('臨時密碼已重設');
        } catch (error) {
          showToast(`重設失敗：${error.message}`, 'error');
        } finally {
          setSaving(false);
        }
      }}
      className="mt-4 flex gap-2 border-t border-zinc-800 pt-4"
    >
      <input className={`${inputClass()} font-mono`} minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} />
      <button type="button" onClick={() => setPassword(generateTemporaryPassword())} title="重新產生密碼" className="rounded-lg border border-zinc-700 px-3 text-zinc-400">
        <RefreshCw className="h-4 w-4" />
      </button>
      <button disabled={saving} className="shrink-0 rounded-lg bg-orange-600 px-4 text-sm font-bold text-white disabled:bg-zinc-700">
        {saving ? '處理中' : '重設'}
      </button>
    </form>
  );
}

function ReportsTab({ data, showToast, adminCall }) {
  const owner = data.profile.role === 'owner';
  const [date, setDate] = useState(todayKey());
  const [contractorId, setContractorId] = useState(owner ? '' : data.profile.contractorId);
  const [loading, setLoading] = useState('');
  const [result, setResult] = useState(null);

  const generate = async (type) => {
    if (type === 'company' && !contractorId) {
      showToast('請選擇承包商', 'error');
      return;
    }
    setLoading(type);
    setResult(null);
    try {
      const report = await adminCall('adminGenerateReport', {
        type,
        date,
        contractorId
      });
      setResult(report);
      showToast('PDF 已產生');
    } catch (error) {
      showToast(`產生失敗：${error.message}`, 'error');
    } finally {
      setLoading('');
    }
  };

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-xl font-black text-white">PDF 報表</h2>
        <p className="mt-1 text-xs text-zinc-500">
          主承包商：{data.primaryContractor?.name || '尚未設定'} · 報表僅授權目前管理帳號開啟
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-orange-400" />
            <h3 className="font-bold text-white">每日新增人員</h3>
          </div>
          <div className="mt-4">
            <Field label="報表日期">
              <input type="date" className={inputClass()} value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
          </div>
          <button onClick={() => generate('daily')} disabled={loading === 'daily'} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-3 font-bold text-white disabled:bg-zinc-700">
            {loading === 'daily' ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}
            產生每日 PDF
          </button>
        </section>

        <section className="rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-emerald-400" />
            <h3 className="font-bold text-white">公司完整人員</h3>
          </div>
          <div className="mt-4">
            <Field label="人員所屬公司">
              {owner ? (
                <select className={inputClass()} value={contractorId} onChange={(event) => setContractorId(event.target.value)}>
                  <option value="">請選擇</option>
                  {data.contractors.map((contractor) => (
                    <option key={contractor.id} value={contractor.id}>{contractorOptionLabel(contractor)}</option>
                  ))}
                </select>
              ) : (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-3 text-sm text-zinc-300">
                  {data.profile.contractorName}
                </div>
              )}
            </Field>
          </div>
          <button onClick={() => generate('company')} disabled={loading === 'company'} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 font-bold text-white disabled:bg-zinc-700">
            {loading === 'company' ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}
            產生完整名冊 PDF
          </button>
        </section>
      </div>

      {result && (
        <section className="mt-5 flex flex-col gap-3 rounded-lg border border-emerald-800 bg-emerald-950/20 p-4 sm:flex-row sm:items-center">
          <Check className="h-5 w-5 shrink-0 text-emerald-400" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold text-white">{result.filename}</p>
            <p className="text-xs text-zinc-500">{result.scopeLabel} · 共 {result.count} 位人員</p>
          </div>
          <a href={result.url} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white">
            <Download className="h-4 w-4" />
            開啟 PDF
          </a>
        </section>
      )}
    </div>
  );
}

function PasswordPanel({ required = false, profile, adminCall, showToast, onChanged }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (newPassword !== confirmation) {
          showToast('兩次輸入的新密碼不一致', 'error');
          return;
        }
        setSaving(true);
        try {
          const result = await adminCall('adminChangePassword', { currentPassword, newPassword });
          setCurrentPassword('');
          setNewPassword('');
          setConfirmation('');
          await onChanged?.(result.profile);
          showToast('密碼已更新');
        } catch (error) {
          showToast(`更新失敗：${error.message}`, 'error');
        } finally {
          setSaving(false);
        }
      }}
      className="rounded-lg border border-zinc-800 p-4"
    >
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-5 w-5 text-orange-400" />
        <div>
          <h3 className="font-bold text-white">{required ? '請先更換臨時密碼' : '變更登入密碼'}</h3>
          <p className="mt-1 text-xs text-zinc-500">{profile.email}</p>
        </div>
      </div>
      <div className="mt-5 grid gap-4">
        <Field label="目前密碼" required>
          <input required type="password" autoComplete="current-password" className={inputClass()} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        </Field>
        <Field label="新密碼" required>
          <input required type="password" minLength={12} autoComplete="new-password" className={inputClass()} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        </Field>
        <Field label="再次輸入新密碼" required>
          <input required type="password" minLength={12} autoComplete="new-password" className={inputClass()} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </Field>
      </div>
      <button disabled={saving} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-3 font-bold text-white disabled:bg-zinc-700">
        {saving ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
        更新密碼
      </button>
    </form>
  );
}

function SettingsTab({ data, setData, showToast, adminCall, onLogout }) {
  const owner = data.profile.role === 'owner';
  const [backupLoading, setBackupLoading] = useState(false);
  const [backup, setBackup] = useState(null);
  const [migrationLoading, setMigrationLoading] = useState(false);
  const [migration, setMigration] = useState(null);
  return (
    <div>
      <div className="mb-5">
        <h2 className="text-xl font-black text-white">帳號與系統</h2>
        <p className="mt-1 text-xs text-zinc-500">
          {data.profile.displayName} · {owner ? `主要管理者｜${data.primaryContractor?.name || '主承包商尚未設定'}` : data.profile.contractorName}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <PasswordPanel
          profile={data.profile}
          adminCall={adminCall}
          showToast={showToast}
          onChanged={(profile) => setData((current) => ({ ...current, profile }))}
        />
        <div className="space-y-4">
          {owner && (
            <>
              <section className="rounded-lg border border-cyan-900/70 p-4">
                <div className="flex items-center gap-3">
                  <DatabaseBackup className="h-5 w-5 text-cyan-400" />
                  <div>
                    <h3 className="font-bold text-white">Supabase 資料搬移</h3>
                    <p className="mt-1 text-xs text-zinc-500">複製現有名冊資料，完成後再切換資料來源</p>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    setMigrationLoading(true);
                    try {
                      const result = await adminCall('adminSyncSupabase');
                      setMigration(result);
                      showToast(`已同步 ${result.workers} 位人員`);
                    } catch (error) {
                      showToast(`搬移失敗：${error.message}`, 'error');
                    } finally {
                      setMigrationLoading(false);
                    }
                  }}
                  disabled={migrationLoading}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-800 px-4 py-3 font-bold text-cyan-400 disabled:text-zinc-600"
                >
                  {migrationLoading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <DatabaseBackup className="h-5 w-5" />}
                  同步現有資料
                </button>
                {migration && (
                  <p className="mt-3 text-center text-xs text-zinc-500">
                    承包商 {migration.contractors} 家 · 人員 {migration.workers} 位 · 管理者 {migration.managers} 位
                  </p>
                )}
              </section>
              <section className="rounded-lg border border-zinc-800 p-4">
                <div className="flex items-center gap-3">
                  <DatabaseBackup className="h-5 w-5 text-emerald-400" />
                  <div>
                    <h3 className="font-bold text-white">資料備份</h3>
                    <p className="mt-1 text-xs text-zinc-500">建立目前資料庫快照</p>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    setBackupLoading(true);
                    try {
                      const result = await adminCall('adminCreateBackup');
                      setBackup(result);
                      showToast('備份已建立');
                    } catch (error) {
                      showToast(`備份失敗：${error.message}`, 'error');
                    } finally {
                      setBackupLoading(false);
                    }
                  }}
                  disabled={backupLoading}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-800 px-4 py-3 font-bold text-emerald-400 disabled:text-zinc-600"
                >
                  {backupLoading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <DatabaseBackup className="h-5 w-5" />}
                  立即備份
                </button>
                {backup && <a href={backup.url} target="_blank" rel="noreferrer" className="mt-3 block truncate text-center text-xs text-emerald-400">{backup.name}</a>}
              </section>
            </>
          )}
          <section className="rounded-lg border border-zinc-800 p-4">
            <div className="flex items-center gap-3">
              <LogOut className="h-5 w-5 text-zinc-500" />
              <h3 className="font-bold text-white">登出管理後台</h3>
            </div>
            <button onClick={onLogout} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 px-4 py-3 font-bold text-zinc-300">
              <LogOut className="h-5 w-5" />
              登出
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
