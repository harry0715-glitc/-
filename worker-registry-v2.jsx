import { useState, useEffect, useRef, useCallback } from "react";

// ── Config keys ────────────────────────────────────────────────
const LS_URL  = 'wr_script_url';
const LS_PASS = 'wr_admin_pass';
const DEFAULT_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || '';

// ── API ────────────────────────────────────────────────────────
const API = {
  getUrl: () => localStorage.getItem(LS_URL) || DEFAULT_SCRIPT_URL,
  setUrl: (u) => localStorage.setItem(LS_URL, u),
  hasDefaultUrl: () => Boolean(DEFAULT_SCRIPT_URL),

  async load() {
    const url = this.getUrl();
    if (!url) throw new Error('未設定網址');
    const res = await fetch(url + '?action=getData', { redirect: 'follow' });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    return json.data; // { contractors, workers }
  },

  async call(action, payload = {}) {
    const url = this.getUrl();
    if (!url) throw new Error('未設定網址');
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ action, payload }),
      redirect: 'follow',
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    return json.data;
  },
};

// ── Browser + image helpers ─────────────────────────────────────
const isInAppBrowser = () => {
  const ua = navigator.userAgent || '';
  return /Line|FBAN|FBAV|Instagram|Messenger|MicroMessenger/i.test(ua);
};

const readImageFile = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const cropImage = (src, crop, outW = 480, outH = 560, q = 0.78) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const cvs = document.createElement('canvas');
      cvs.width = outW;
      cvs.height = outH;
      const ctx = cvs.getContext('2d');
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, outW, outH);
      ctx.save();
      ctx.translate(outW / 2 + crop.x * 1.6, outH / 2 + crop.y * 1.6);
      ctx.scale(crop.scale, crop.scale);
      const cover = Math.max(outW / img.width, outH / img.height);
      ctx.scale(cover, cover);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
      resolve(cvs.toDataURL('image/jpeg', q));
    };
    img.onerror = reject;
    img.src = src;
  });

// ── Icons ──────────────────────────────────────────────────────
const PATHS = {
  home:     "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10",
  user:     "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M12 11a4 4 0 100-8 4 4 0 000 8",
  search:   "M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0",
  settings: "M12 20h9 M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z",
  plus:     "M12 5v14M5 12h14",
  trash:    "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  chevron:  "M9 18l6-6-6-6",
  back:     "M19 12H5M12 19l-7-7 7-7",
  camera:   "M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z M12 17a4 4 0 100-8 4 4 0 000 8",
  image:    "M21 19V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21",
  building: "M3 21h18M3 7v14M21 7v14M6 3h12l3 4H3zM9 21V9h6v12",
  lock:     "M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2zM7 11V7a5 5 0 0110 0v4",
  check:    "M20 6L9 17l-5-5",
  warning:  "M12 2L2 22h20zM12 9v4M12 17h.01",
  hardhat:  "M2 20h20M4 20v-4a8 8 0 0116 0v4M9 12V8h6v4",
  link:     "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71 M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71",
  refresh:  "M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15",
  cloud:    "M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z",
};
const Icon = ({ name, cls = '' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" className={cls}>
    {(PATHS[name] || '').split('M').filter(Boolean).map((d, i) => (
      <path key={i} d={'M' + d} />
    ))}
  </svg>
);

// ── Shared UI pieces ────────────────────────────────────────────
const Field = ({ label, error, children, required }) => (
  <div>
    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
      {label}{required && <span className="text-orange-400 ml-0.5">*</span>}
    </label>
    {children}
    {error && (
      <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
        <Icon name="warning" cls="w-3 h-3" />{error}
      </p>
    )}
  </div>
);

const iCls = (err) =>
  `w-full bg-slate-800/60 border ${err ? 'border-red-500/60' : 'border-slate-600/50'} rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-orange-500/70 focus:bg-slate-800 transition-all`;

function Toast({ msg, type, visible }) {
  return (
    <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}>
      <div className={`px-5 py-3 rounded-2xl text-sm font-semibold shadow-2xl flex items-center gap-2 ${type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
        <Icon name={type === 'success' ? 'check' : 'warning'} cls="w-4 h-4" />
        {msg}
      </div>
    </div>
  );
}

function InAppBrowserNotice({ showToast }) {
  if (!isInAppBrowser()) return null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      showToast('網址已複製，請貼到 Chrome 或 Safari 開啟');
    } catch {
      showToast('請長按網址複製後，用外部瀏覽器開啟', 'error');
    }
  };

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-4">
      <div className="flex items-start gap-2.5">
        <Icon name="warning" cls="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-amber-200 text-sm font-bold">目前在通訊軟體內建瀏覽器中</p>
          <p className="text-amber-200/70 text-xs leading-relaxed mt-1">LINE 等內建瀏覽器可能擋住拍照權限。請用右上角選單改用 Chrome / Safari 開啟，或複製網址後貼到瀏覽器。</p>
          <button onClick={copyLink}
            className="mt-3 bg-amber-500/20 border border-amber-400/30 text-amber-200 rounded-lg px-3 py-2 text-xs font-bold">
            複製網址
          </button>
        </div>
      </div>
    </div>
  );
}

function PhotoCropper({ src, onCancel, onDone, showToast }) {
  const [crop, setCrop] = useState({ scale: 1.15, x: 0, y: -8 });
  const [drag, setDrag] = useState(null);

  const update = (key) => (e) => {
    const value = Number(e.target.value);
    setCrop(c => ({ ...c, [key]: value }));
  };

  const startDrag = (e) => {
    const point = e.touches?.[0] || e;
    setDrag({ px: point.clientX, py: point.clientY, x: crop.x, y: crop.y });
  };

  const moveDrag = (e) => {
    if (!drag) return;
    const point = e.touches?.[0] || e;
    setCrop(c => ({
      ...c,
      x: Math.max(-90, Math.min(90, drag.x + point.clientX - drag.px)),
      y: Math.max(-110, Math.min(110, drag.y + point.clientY - drag.py)),
    }));
  };

  const finish = async () => {
    try {
      const cropped = await cropImage(src, crop);
      onDone(cropped);
      showToast('照片已裁切');
    } catch {
      showToast('照片裁切失敗，請重新選取', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-slate-950 flex flex-col">
      <div className="px-4 pt-12 pb-4 border-b border-slate-800">
        <button onClick={onCancel} className="flex items-center gap-1.5 text-slate-400 text-sm mb-3">
          <Icon name="back" cls="w-4 h-4" /> 取消
        </button>
        <h2 className="text-xl font-black text-white">裁切人員照片</h2>
        <p className="text-slate-500 text-xs mt-1">讓臉部位在框線中間，肩膀保留一點空間</p>
      </div>

      <div className="flex-1 flex flex-col justify-center px-4 py-5">
        <div className="mx-auto w-full max-w-[320px]">
          <div
            className="relative mx-auto w-full aspect-[6/7] overflow-hidden rounded-2xl bg-slate-900 border border-slate-700 touch-none"
            onMouseDown={startDrag}
            onMouseMove={moveDrag}
            onMouseUp={() => setDrag(null)}
            onMouseLeave={() => setDrag(null)}
            onTouchStart={startDrag}
            onTouchMove={moveDrag}
            onTouchEnd={() => setDrag(null)}
          >
            <img
              src={src}
              alt="crop preview"
              className="absolute left-1/2 top-1/2 min-w-full min-h-full max-w-none select-none"
              draggable="false"
              style={{
                transform: `translate(calc(-50% + ${crop.x}px), calc(-50% + ${crop.y}px)) scale(${crop.scale})`,
              }}
            />
            <div className="absolute inset-x-[18%] top-[16%] h-[44%] rounded-full border-2 border-white/80 shadow-[0_0_0_999px_rgb(2_6_23/0.35)]" />
            <div className="absolute inset-0 border-4 border-slate-950/20 pointer-events-none" />
          </div>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-xs font-bold text-slate-500">臉部大小</span>
              <input type="range" min="1" max="2.4" step="0.01" value={crop.scale} onChange={update('scale')}
                className="w-full accent-orange-500" />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500">左右位置</span>
              <input type="range" min="-90" max="90" step="1" value={crop.x} onChange={update('x')}
                className="w-full accent-orange-500" />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500">上下位置</span>
              <input type="range" min="-110" max="110" step="1" value={crop.y} onChange={update('y')}
                className="w-full accent-orange-500" />
            </label>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-800 p-4 bg-slate-950">
        <button onClick={finish}
          className="w-full bg-gradient-to-r from-orange-600 to-amber-500 text-white rounded-2xl py-4 font-bold active:scale-95 transition-all">
          確認裁切
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// APP ROOT
// ══════════════════════════════════════════════════════
export default function App() {
  const [view, setView] = useState('loading');
  const [contractors, setContractors] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [adminAuth, setAdminAuth] = useState(false);
  const [adminPass, setAdminPassState] = useState(() => localStorage.getItem(LS_PASS) || '0000');
  const [toast, setToast] = useState({ msg: '', type: 'success', visible: false });
  const [initError, setInitError] = useState('');

  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type, visible: true });
    setTimeout(() => setToast(t => ({ ...t, visible: false })), 3000);
  }, []);

  const loadData = useCallback(async () => {
    if (!API.getUrl()) { setView('setup'); return; }
    setView('loading');
    try {
      const { contractors: c, workers: w } = await API.load();
      setContractors(c || []);
      setWorkers(w || []);
      setView('home');
    } catch (err) {
      setInitError(err.message);
      setView('error');
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const setAdminPass = (p) => { setAdminPassState(p); localStorage.setItem(LS_PASS, p); };

  // ── Handlers passed to children ────────────────────
  const handleAddContractor = async (co) => {
    await API.call('addContractor', co);
    setContractors(prev => [...prev, co]);
  };
  const handleDeleteContractor = async (id) => {
    await API.call('deleteContractor', { id });
    setContractors(prev => prev.filter(c => c.id !== id));
  };
  const handleAddWorker = async (worker) => {
    const result = await API.call('addWorker', worker);
    const saved = { ...worker, photo: null, photoUrl: result.photoUrl || '' };
    setWorkers(prev => [...prev, saved]);
    return result;
  };
  const handleDeleteWorker = async (id) => {
    await API.call('deleteWorker', { id });
    setWorkers(prev => prev.filter(w => w.id !== id));
  };

  const shared = {
    setView, contractors, workers, adminAuth, setAdminAuth,
    adminPass, setAdminPass, showToast, loadData,
    onAddContractor: handleAddContractor,
    onDeleteContractor: handleDeleteContractor,
    onAddWorker: handleAddWorker,
    onDeleteWorker: handleDeleteWorker,
  };

  return (
    <div className="app-shell min-h-screen bg-slate-950" style={{ fontFamily: "'Noto Sans TC','PingFang TC',system-ui,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700;900&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        ::-webkit-scrollbar{width:0}
        select option{background:#1e293b;color:#f1f5f9}
        input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.6)}
        @keyframes spin{to{transform:rotate(360deg)}}
        .spin{animation:spin 1s linear infinite}
      `}</style>
      <Toast {...toast} />

      {view === 'setup'   && <SetupView onDone={loadData} />}
      {view === 'loading' && <LoadingView />}
      {view === 'error'   && <ErrorView msg={initError} onRetry={loadData} onSetup={() => setView('setup')} />}
      {view === 'home'    && <HomeView {...shared} />}
      {view === 'register' && <RegisterView {...shared} />}
      {view === 'query'   && <QueryView {...shared} />}
      {view === 'adminLogin' && <AdminLoginView {...shared} />}
      {view === 'admin' && adminAuth && <AdminView {...shared} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// SETUP VIEW
// ══════════════════════════════════════════════════════
function SetupView({ onDone }) {
  const [url, setUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    const trimmed = url.trim();
    if (!trimmed.includes('script.google.com')) {
      setError('請貼上正確的 Google Apps Script 網址（包含 script.google.com）');
      return;
    }
    setTesting(true); setError('');
    try {
      API.setUrl(trimmed);
      await API.load();
      onDone();
    } catch (err) {
      setError('連線失敗：' + err.message + '。請確認網址正確且已部署。');
      setTesting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-orange-500/10 border border-orange-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Icon name="cloud" cls="w-8 h-8 text-orange-500" />
          </div>
          <h1 className="text-2xl font-black text-white">連結 Google 雲端</h1>
          <p className="text-slate-500 text-sm mt-2">貼上 Apps Script 部署網址以啟用</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
          <Field label="Apps Script 網址" error={error}>
            <textarea
              className={`${iCls(error)} resize-none`}
              rows={3}
              placeholder="https://script.google.com/macros/s/...../exec"
              value={url}
              onChange={e => { setUrl(e.target.value); setError(''); }}
            />
          </Field>

          <button
            onClick={handleSave}
            disabled={testing || !url.trim()}
            className="w-full bg-gradient-to-r from-orange-600 to-amber-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white rounded-xl py-3.5 font-bold flex items-center justify-center gap-2 active:scale-95 transition-all">
            {testing
              ? <><Icon name="refresh" cls="w-4 h-4 spin" /> 連線測試中…</>
              : <><Icon name="link" cls="w-4 h-4" /> 儲存並連線</>}
          </button>
        </div>

        <div className="mt-6 bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <p className="text-xs font-bold text-orange-400 mb-3">📋 設定步驟</p>
          {[
            '前往 script.google.com',
            '新增專案 → 貼上 Code.gs 程式碼',
            '部署 → 新增部署項目 → 網路應用程式',
            '執行身分：我、存取對象：任何人',
            '複製部署網址貼上方',
          ].map((s, i) => (
            <div key={i} className="flex items-start gap-2.5 mb-2 last:mb-0">
              <div className="w-5 h-5 bg-orange-500/20 border border-orange-500/30 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-orange-400 text-[10px] font-bold">{i + 1}</span>
              </div>
              <p className="text-slate-400 text-xs leading-relaxed">{s}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Loading / Error ─────────────────────────────────────────────
function LoadingView() {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
      <div className="w-12 h-12 bg-orange-500/10 border border-orange-500/30 rounded-2xl flex items-center justify-center">
        <Icon name="refresh" cls="w-6 h-6 text-orange-500 spin" />
      </div>
      <p className="text-slate-500 text-sm">連線 Google 雲端中…</p>
    </div>
  );
}
function ErrorView({ msg, onRetry, onSetup }) {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
      <Icon name="warning" cls="w-12 h-12 text-red-400 mx-auto mb-4" />
      <h2 className="text-xl font-black text-white mb-2">連線失敗</h2>
      <p className="text-slate-500 text-sm mb-8 max-w-xs">{msg}</p>
      <div className="space-y-3 w-full max-w-xs">
        <button onClick={onRetry} className="w-full bg-orange-600 text-white rounded-2xl py-3.5 font-bold active:scale-95 transition-all">重新連線</button>
        <button onClick={onSetup} className="w-full bg-slate-900 border border-slate-700 text-slate-300 rounded-2xl py-3.5 font-medium">重新設定網址</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// HOME VIEW
// ══════════════════════════════════════════════════════
function HomeView({ setView, workers, contractors, loadData }) {
  const today = workers.filter(w => new Date(w.createdAt).toDateString() === new Date().toDateString());

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <div className="relative px-6 pt-14 pb-8 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: 'repeating-linear-gradient(45deg,#fff 0,#fff 1px,transparent 0,transparent 50%)', backgroundSize: '20px 20px' }} />
        <div className="absolute top-0 right-0 w-48 h-48 rounded-full bg-orange-500/10 blur-3xl -translate-y-1/2 translate-x-1/4" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-11 h-11 bg-gradient-to-br from-orange-500 to-amber-600 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-500/30">
              <Icon name="hardhat" cls="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="text-xs font-semibold text-orange-400 tracking-[0.15em] uppercase">Construction</div>
              <div className="text-sm font-bold text-white">人員名冊系統</div>
            </div>
            <button onClick={loadData} className="ml-auto p-2 text-slate-600 hover:text-orange-400 transition-colors" title="重新整理">
              <Icon name="refresh" cls="w-4 h-4" />
            </button>
          </div>
          <h1 className="text-3xl font-black text-white leading-tight mb-1">施工人員<br /><span className="text-orange-500">名冊管理</span></h1>
          <p className="text-slate-500 text-sm">已連結 Google 雲端 · 資料自動同步</p>
        </div>
      </div>

      <div className="mx-6 mb-6">
        <div className="grid grid-cols-3 gap-2">
          {[
            { val: workers.length, label: '登記人員', icon: 'user' },
            { val: contractors.length, label: '承包商', icon: 'building' },
            { val: today.length, label: '今日新增', icon: 'plus' },
          ].map(({ val, label, icon }) => (
            <div key={label} className="bg-slate-900 border border-slate-800 rounded-2xl p-3 text-center">
              <Icon name={icon} cls="w-4 h-4 text-orange-500 mx-auto mb-1" />
              <div className="text-2xl font-black text-white leading-none">{val}</div>
              <div className="text-slate-500 text-xs mt-1">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-6 space-y-3 flex-1">
        <button onClick={() => setView('register')}
          className="group w-full bg-gradient-to-r from-orange-600 to-amber-500 rounded-2xl p-5 flex items-center gap-4 shadow-lg shadow-orange-500/20 active:scale-95 transition-all duration-150">
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <Icon name="user" cls="w-6 h-6 text-white" />
          </div>
          <div className="text-left flex-1">
            <div className="font-bold text-white text-base">填寫人員資料</div>
            <div className="text-orange-100/70 text-xs mt-0.5">新增施工人員 · 上傳照片 · 同步至 Drive</div>
          </div>
          <Icon name="chevron" cls="w-5 h-5 text-white/60 group-hover:translate-x-1 transition-transform" />
        </button>

        <button onClick={() => setView('query')}
          className="group w-full bg-slate-900 border border-slate-700/60 rounded-2xl p-5 flex items-center gap-4 active:scale-95 transition-all duration-150">
          <div className="w-12 h-12 bg-slate-800 rounded-xl flex items-center justify-center flex-shrink-0">
            <Icon name="search" cls="w-6 h-6 text-orange-400" />
          </div>
          <div className="text-left flex-1">
            <div className="font-bold text-white text-base">查詢名冊</div>
            <div className="text-slate-500 text-xs mt-0.5">搜尋 · 篩選 · 查看人員資料</div>
          </div>
          <Icon name="chevron" cls="w-5 h-5 text-slate-600 group-hover:translate-x-1 transition-transform" />
        </button>

        <button onClick={() => setView('adminLogin')}
          className="group w-full bg-slate-900 border border-slate-700/60 rounded-2xl p-5 flex items-center gap-4 active:scale-95 transition-all duration-150">
          <div className="w-12 h-12 bg-slate-800 rounded-xl flex items-center justify-center flex-shrink-0">
            <Icon name="settings" cls="w-6 h-6 text-slate-400" />
          </div>
          <div className="text-left flex-1">
            <div className="font-bold text-white text-base">管理後台</div>
            <div className="text-slate-500 text-xs mt-0.5">包商管理 · 人員管理 · 設定</div>
          </div>
          <Icon name="lock" cls="w-4 h-4 text-slate-600 mr-1" />
          <Icon name="chevron" cls="w-5 h-5 text-slate-600 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
      <div className="text-center py-6">
        <div className="inline-flex items-center gap-1.5 text-xs text-emerald-500/70 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full">
          <Icon name="cloud" cls="w-3 h-3" /> Google Drive 已連結
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// REGISTER VIEW
// ══════════════════════════════════════════════════════
function RegisterView({ setView, contractors, onAddWorker, showToast }) {
  const [form, setForm] = useState({
    name: '', idNumber: '', phone: '', jobTitle: '', contractorId: '',
    entryDate: new Date().toISOString().split('T')[0], notes: ''
  });
  const [photo, setPhoto] = useState(null);
  const [cropSource, setCropSource] = useState(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState({});
  const [savedPhotoUrl, setSavedPhotoUrl] = useState('');
  const cameraRef = useRef();
  const galleryRef = useRef();

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = '請填寫姓名';
    if (!form.contractorId) e.contractorId = '請選擇所屬包商';
    if (!form.jobTitle.trim()) e.jobTitle = '請填寫工作職稱';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('請選擇圖片檔', 'error');
      return;
    }
    const dataUrl = await readImageFile(file);
    setCropSource(dataUrl);
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const worker = {
        id: Date.now().toString(),
        ...form,
        photo,
        createdAt: new Date().toISOString()
      };
      const result = await onAddWorker(worker);
      setSavedPhotoUrl(result?.photoUrl || '');
      setDone(true);
      showToast('登記成功！已同步至 Google 雲端');
    } catch (err) {
      showToast('儲存失敗：' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (done) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        <div className="w-24 h-24 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border-2 border-emerald-500/30">
          <Icon name="check" cls="w-12 h-12 text-emerald-400" />
        </div>
        <h2 className="text-2xl font-black text-white mb-2">登記成功！</h2>
        {savedPhotoUrl
          ? <p className="text-slate-400 text-sm mb-1">照片已上傳至 Google Drive</p>
          : <p className="text-slate-400 text-sm mb-1">資料已同步至 Google 雲端</p>}
        <div className="flex items-center justify-center gap-1.5 text-emerald-500/70 text-xs mb-8">
          <Icon name="cloud" cls="w-3 h-3" /> Google Drive · Sheets 已更新
        </div>
        <div className="space-y-3">
          <button onClick={() => { setForm({ name:'',idNumber:'',phone:'',jobTitle:'',contractorId:'',entryDate:new Date().toISOString().split('T')[0],notes:'' }); setPhoto(null); setDone(false); setSavedPhotoUrl(''); }}
            className="w-full bg-gradient-to-r from-orange-600 to-amber-500 text-white rounded-2xl py-4 font-bold active:scale-95 transition-all">
            繼續登記下一位
          </button>
          <button onClick={() => setView('home')} className="w-full bg-slate-900 border border-slate-700 text-slate-300 rounded-2xl py-4 font-medium">返回首頁</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950">
      {cropSource && (
        <PhotoCropper
          src={cropSource}
          showToast={showToast}
          onCancel={() => setCropSource(null)}
          onDone={(cropped) => {
            setPhoto(cropped);
            setCropSource(null);
          }}
        />
      )}
      <div className="sticky top-0 z-10 bg-slate-950/90 backdrop-blur px-4 pt-12 pb-4 border-b border-slate-800/60">
        <button onClick={() => setView('home')} className="flex items-center gap-1.5 text-slate-400 text-sm mb-3 hover:text-white transition-colors">
          <Icon name="back" cls="w-4 h-4" /> 返回
        </button>
        <h1 className="text-xl font-black text-white">填寫人員資料</h1>
        <p className="text-slate-500 text-xs mt-0.5">填寫後將自動同步至 Google Drive</p>
      </div>

      <div className="px-4 py-5 pb-32 space-y-5">
        <InAppBrowserNotice showToast={showToast} />

        {/* Photo */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">人員照片</div>
          <div className="flex items-start gap-4">
            <div className="w-24 h-28 rounded-xl overflow-hidden bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
              {photo ? <img src={photo} className="w-full h-full object-cover" alt="preview" />
                : <Icon name="user" cls="w-10 h-10 text-slate-600" />}
            </div>
            <div className="flex-1 space-y-2">
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
              <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
              <button onClick={() => cameraRef.current?.click()}
                className="w-full bg-orange-600/20 border border-orange-500/40 text-orange-400 rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 active:scale-95 transition-all">
                <Icon name="camera" cls="w-4 h-4" /> 拍照
              </button>
              <button onClick={() => galleryRef.current?.click()}
                className="w-full bg-slate-800 border border-slate-700 text-slate-300 rounded-xl py-2.5 text-sm font-medium flex items-center justify-center gap-2 active:scale-95 transition-all">
                <Icon name="image" cls="w-4 h-4" /> 從相簿選取
              </button>
              {photo && <button onClick={() => setPhoto(null)} className="w-full text-slate-500 text-xs py-1">✕ 移除照片</button>}
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">基本資料</div>
          <Field label="姓名" error={errors.name} required>
            <input className={iCls(errors.name)} placeholder="請輸入姓名" value={form.name} onChange={set('name')} />
          </Field>
          <Field label="身分證字號">
            <input className={iCls()} placeholder="A123456789（選填）" value={form.idNumber} onChange={set('idNumber')} />
          </Field>
          <Field label="手機號碼">
            <input type="tel" className={iCls()} placeholder="09XXXXXXXX（選填）" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="工作職稱" error={errors.jobTitle} required>
            <input className={iCls(errors.jobTitle)} placeholder="例：水電工、鋼筋工、模板工" value={form.jobTitle} onChange={set('jobTitle')} />
          </Field>
          <Field label="所屬承包商" error={errors.contractorId} required>
            <select className={iCls(errors.contractorId)} value={form.contractorId} onChange={set('contractorId')}>
              <option value="">— 請選擇包商 —</option>
              {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="進場日期">
            <input type="date" className={iCls()} value={form.entryDate} onChange={set('entryDate')} />
          </Field>
          <Field label="備註">
            <textarea className={iCls()} rows={2} placeholder="其他備注…（選填）" value={form.notes} onChange={set('notes')} />
          </Field>
        </div>

        {contractors.length === 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
            <Icon name="warning" cls="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-amber-300/80 text-sm">尚未設定包商，請先在後台新增承包商資料</p>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-slate-950/90 backdrop-blur border-t border-slate-800 p-4">
        <button onClick={handleSubmit} disabled={saving || contractors.length === 0}
          className="w-full bg-gradient-to-r from-orange-600 to-amber-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white rounded-2xl py-4 font-bold text-base shadow-lg shadow-orange-500/20 active:scale-95 transition-all flex items-center justify-center gap-2">
          {saving
            ? <><Icon name="refresh" cls="w-5 h-5 spin" /> 上傳至雲端中…</>
            : '✓  確認送出'}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// QUERY VIEW
// ══════════════════════════════════════════════════════
function QueryView({ setView, workers, contractors, loadData }) {
  const [search, setSearch] = useState('');
  const [filterCo, setFilterCo] = useState('');
  const [selected, setSelected] = useState(null);

  const getName = id => contractors.find(c => c.id === id)?.name || '未知';
  const filtered = workers.filter(w => {
    const s = search.toLowerCase();
    return (!s || w.name?.includes(s) || (w.idNumber||'').includes(s) || (w.phone||'').includes(s) || (w.jobTitle||'').toLowerCase().includes(s))
      && (!filterCo || w.contractorId === filterCo);
  });

  if (selected) return (
    <WorkerDetail worker={selected} contractorName={getName(selected.contractorId)} onBack={() => setSelected(null)} />
  );

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="sticky top-0 z-10 bg-slate-950/90 backdrop-blur border-b border-slate-800/60 px-4 pt-12 pb-4">
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => setView('home')} className="flex items-center gap-1.5 text-slate-400 text-sm">
            <Icon name="back" cls="w-4 h-4" /> 返回
          </button>
          <button onClick={loadData} className="ml-auto text-slate-500 hover:text-orange-400 transition-colors p-1">
            <Icon name="refresh" cls="w-4 h-4" />
          </button>
        </div>
        <h1 className="text-xl font-black text-white mb-3">人員名冊查詢</h1>
        <div className="relative mb-2">
          <Icon name="search" cls="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-slate-200 placeholder-slate-500 text-sm focus:outline-none focus:border-orange-500/50"
            placeholder="搜尋姓名、身分證、電話、職稱…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-slate-300 text-sm focus:outline-none"
          value={filterCo} onChange={e => setFilterCo(e.target.value)}>
          <option value="">全部包商</option>
          {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <p className="text-slate-600 text-xs mt-2">顯示 {filtered.length} / 共 {workers.length} 筆</p>
      </div>

      <div className="px-4 py-3 space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <Icon name="search" cls="w-12 h-12 text-slate-700 mx-auto mb-4" />
            <p className="text-slate-600">查無資料</p>
          </div>
        ) : filtered.map(w => (
          <button key={w.id} onClick={() => setSelected(w)}
            className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-3 flex items-center gap-3 text-left active:scale-95 transition-all hover:border-slate-700">
            <div className="w-14 h-16 rounded-xl overflow-hidden bg-slate-800 border border-slate-700 flex-shrink-0 flex items-center justify-center">
              {w.photoUrl
                ? <img src={w.photoUrl} className="w-full h-full object-cover" alt={w.name} onError={e => e.target.style.display='none'} />
                : <Icon name="user" cls="w-7 h-7 text-slate-600" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-white text-sm">{w.name}</div>
              <div className="text-orange-400 text-xs mt-0.5">{w.jobTitle}</div>
              <div className="text-slate-500 text-xs mt-0.5 flex items-center gap-1">
                <Icon name="building" cls="w-3 h-3" />{getName(w.contractorId)}
              </div>
            </div>
            <Icon name="chevron" cls="w-5 h-5 text-slate-600 flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkerDetail({ worker: w, contractorName, onBack }) {
  const rows = [
    { label: '身分證字號', value: w.idNumber || '—' },
    { label: '手機號碼',   value: w.phone || '—' },
    { label: '所屬包商',   value: contractorName },
    { label: '進場日期',   value: w.entryDate || '—' },
    { label: '備註',       value: w.notes || '—' },
    { label: '登記時間',   value: w.createdAt ? new Date(w.createdAt).toLocaleString('zh-TW') : '—' },
  ];
  return (
    <div className="min-h-screen bg-slate-950">
      <div className="bg-slate-950 border-b border-slate-800 px-4 pt-12 pb-5">
        <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 text-sm mb-4">
          <Icon name="back" cls="w-4 h-4" /> 返回名單
        </button>
        <div className="flex items-center gap-4">
          <div className="w-20 h-24 rounded-2xl overflow-hidden bg-slate-800 border border-slate-700 flex-shrink-0 flex items-center justify-center">
            {w.photoUrl
              ? <img src={w.photoUrl} className="w-full h-full object-cover" alt={w.name} />
              : <Icon name="user" cls="w-10 h-10 text-slate-600" />}
          </div>
          <div>
            <h1 className="text-2xl font-black text-white">{w.name}</h1>
            <div className="inline-block mt-1 px-2.5 py-1 bg-orange-500/15 border border-orange-500/30 rounded-lg text-orange-400 text-xs font-semibold">{w.jobTitle}</div>
          </div>
        </div>
      </div>
      <div className="px-4 py-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          {rows.map((r, i) => (
            <div key={i} className={`flex px-4 py-3.5 ${i < rows.length - 1 ? 'border-b border-slate-800/60' : ''}`}>
              <div className="w-28 text-xs text-slate-500 flex-shrink-0 pt-0.5">{r.label}</div>
              <div className="text-sm text-slate-200 font-medium flex-1">{r.value}</div>
            </div>
          ))}
        </div>
        {w.photoUrl && (
          <a href={w.photoUrl} target="_blank" rel="noopener noreferrer"
            className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-500 hover:text-orange-400 transition-colors py-2">
            <Icon name="cloud" cls="w-3.5 h-3.5" /> 在 Google Drive 查看原圖
          </a>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// ADMIN LOGIN
// ══════════════════════════════════════════════════════
function AdminLoginView({ adminPass, setAdminAuth, setView, adminAuth }) {
  const [input, setInput] = useState('');
  const [shake, setShake] = useState(false);
  const [attempt, setAttempt] = useState(false);

  useEffect(() => { if (adminAuth) setView('admin'); }, []);

  const handleLogin = () => {
    if (input === adminPass) { setAdminAuth(true); setView('admin'); }
    else { setShake(true); setAttempt(true); setTimeout(() => setShake(false), 600); }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-slate-900 border border-slate-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Icon name="lock" cls="w-8 h-8 text-orange-500" />
          </div>
          <h1 className="text-2xl font-black text-white">管理後台</h1>
          <p className="text-slate-500 text-sm mt-1">輸入管理密碼以繼續</p>
        </div>
        <div style={{ animation: shake ? 'shake 0.5s ease' : 'none' }}>
          <div className={`bg-slate-900 border ${attempt && !shake ? 'border-red-500/40' : 'border-slate-700'} rounded-2xl p-4 mb-3 transition-colors`}>
            <input type="password" inputMode="numeric"
              className="w-full bg-transparent text-white text-center text-3xl tracking-[1em] placeholder-slate-700 outline-none"
              placeholder="••••" value={input}
              onChange={e => { setInput(e.target.value); setAttempt(false); }}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              autoFocus />
          </div>
        </div>
        {attempt && !shake
          ? <p className="text-red-400 text-sm text-center mb-3 flex items-center justify-center gap-1"><Icon name="warning" cls="w-4 h-4" />密碼錯誤，請重試</p>
          : <div className="mb-3 h-6" />}
        <button onClick={handleLogin} className="w-full bg-gradient-to-r from-orange-600 to-amber-500 text-white rounded-2xl py-4 font-bold mb-3 shadow-lg shadow-orange-500/20 active:scale-95 transition-all">登入後台</button>
        <button onClick={() => setView('home')} className="w-full text-slate-600 py-2 text-sm hover:text-slate-400 transition-colors">返回首頁</button>
        <p className="text-center text-slate-700 text-xs mt-4">預設密碼：0000</p>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// ADMIN VIEW
// ══════════════════════════════════════════════════════
function AdminView(props) {
  const [tab, setTab] = useState('contractors');
  const tabs = [
    { id: 'contractors', icon: 'building', label: '包商' },
    { id: 'workers',     icon: 'user',     label: '人員' },
    { id: 'settings',   icon: 'settings', label: '設定' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <div className="bg-slate-950 border-b border-slate-800 px-4 pt-12 pb-4">
        <div className="flex items-center justify-between mb-1">
          <button onClick={() => props.setView('home')} className="flex items-center gap-1.5 text-slate-400 text-sm">
            <Icon name="back" cls="w-4 h-4" /> 首頁
          </button>
          <div className="flex items-center gap-2">
            <button onClick={props.loadData} className="text-slate-500 hover:text-orange-400 transition-colors p-1"><Icon name="refresh" cls="w-4 h-4" /></button>
            <div className="text-xs text-orange-500 font-semibold bg-orange-500/10 px-2.5 py-1 rounded-full">管理模式</div>
          </div>
        </div>
        <h1 className="text-xl font-black text-white">管理後台</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-24">
        {tab === 'contractors' && <ContractorsTab {...props} />}
        {tab === 'workers'     && <AdminWorkersTab {...props} />}
        {tab === 'settings'    && <SettingsTab {...props} />}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-slate-950/95 backdrop-blur border-t border-slate-800 flex">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 flex flex-col items-center py-3 gap-1 text-xs font-semibold transition-colors ${tab === t.id ? 'text-orange-500' : 'text-slate-600 hover:text-slate-400'}`}>
            <Icon name={t.icon} cls="w-5 h-5" />
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Contractors Tab ─────────────────────────────────────────────
function ContractorsTab({ contractors, onAddContractor, onDeleteContractor, showToast }) {
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const co = { id: Date.now().toString(), name: newName.trim(), createdAt: new Date().toISOString() };
      await onAddContractor(co);
      showToast(`已新增「${newName.trim()}」並建立 Drive 資料夾`);
      setNewName(''); setAdding(false);
    } catch (err) {
      showToast('新增失敗：' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const del = async (id, name) => {
    if (!confirm(`確定刪除「${name}」？`)) return;
    try {
      await onDeleteContractor(id);
      showToast(`已刪除「${name}」`);
    } catch (err) {
      showToast('刪除失敗：' + err.message, 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-black text-white">承包商管理</h2>
          <p className="text-slate-500 text-xs">共 {contractors.length} 家 · 新增後自動建立 Drive 資料夾</p>
        </div>
        <button onClick={() => setAdding(true)}
          className="bg-orange-600 text-white rounded-xl px-4 py-2 text-sm font-bold flex items-center gap-1.5 active:scale-95 transition-all">
          <Icon name="plus" cls="w-4 h-4" /> 新增
        </button>
      </div>

      {adding && (
        <div className="bg-slate-900 border border-orange-500/30 rounded-2xl p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">包商名稱</p>
          <input autoFocus className={iCls()} placeholder="例：大林水電工程行"
            value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          <div className="flex gap-2 mt-3">
            <button onClick={add} disabled={saving}
              className="flex-1 bg-orange-600 text-white rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-50">
              {saving ? <><Icon name="refresh" cls="w-4 h-4 spin" /> 建立中…</> : '確認新增'}
            </button>
            <button onClick={() => { setAdding(false); setNewName(''); }} className="flex-1 bg-slate-800 text-slate-400 rounded-xl py-2.5 text-sm">取消</button>
          </div>
        </div>
      )}

      {contractors.length === 0
        ? <div className="text-center py-16"><Icon name="building" cls="w-12 h-12 text-slate-700 mx-auto mb-3" /><p className="text-slate-600">尚未新增任何包商</p></div>
        : contractors.map((c, i) => (
          <div key={c.id} className="bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-500/10 border border-orange-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-orange-500 text-xs font-bold">{i + 1}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-white text-sm">{c.name}</div>
              <div className="text-slate-600 text-xs">{c.createdAt ? new Date(c.createdAt).toLocaleDateString('zh-TW') : ''}</div>
            </div>
            <button onClick={() => del(c.id, c.name)} className="text-slate-600 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-red-500/10">
              <Icon name="trash" cls="w-4 h-4" />
            </button>
          </div>
        ))
      }
    </div>
  );
}

// ── Admin Workers Tab ───────────────────────────────────────────
function AdminWorkersTab({ workers, contractors, onDeleteWorker, showToast }) {
  const [search, setSearch] = useState('');
  const [filterCo, setFilterCo] = useState('');
  const [selected, setSelected] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const getName = id => contractors.find(c => c.id === id)?.name || '未知';
  const filtered = workers.filter(w => {
    const s = search.toLowerCase();
    return (!s || w.name?.includes(s) || (w.idNumber||'').includes(s) || (w.phone||'').includes(s))
      && (!filterCo || w.contractorId === filterCo);
  });

  const del = async (id) => {
    if (!confirm('確定刪除此人員資料？Sheets 記錄將同步刪除。')) return;
    setDeleting(true);
    try {
      await onDeleteWorker(id);
      showToast('已刪除人員資料');
      setSelected(null);
    } catch (err) {
      showToast('刪除失敗：' + err.message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  if (selected) {
    const w = selected;
    const rows = [
      { label: '身分證字號', value: w.idNumber || '—' },
      { label: '手機號碼',   value: w.phone || '—' },
      { label: '所屬包商',   value: getName(w.contractorId) },
      { label: '進場日期',   value: w.entryDate || '—' },
      { label: '備註',       value: w.notes || '—' },
      { label: '登記時間',   value: w.createdAt ? new Date(w.createdAt).toLocaleString('zh-TW') : '—' },
    ];
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="flex items-center gap-1.5 text-orange-500 text-sm font-medium">
          <Icon name="back" cls="w-4 h-4" /> 返回列表
        </button>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center gap-4 mb-4 pb-4 border-b border-slate-800">
            <div className="w-20 h-24 rounded-xl overflow-hidden bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
              {w.photoUrl
                ? <img src={w.photoUrl} className="w-full h-full object-cover" alt={w.name} />
                : <Icon name="user" cls="w-9 h-9 text-slate-600" />}
            </div>
            <div>
              <h2 className="text-xl font-black text-white">{w.name}</h2>
              <span className="inline-block mt-1 px-2 py-0.5 bg-orange-500/15 border border-orange-500/30 rounded-lg text-orange-400 text-xs font-semibold">{w.jobTitle}</span>
            </div>
          </div>
          {rows.map((r, i) => (
            <div key={i} className={`flex py-3 ${i < rows.length - 1 ? 'border-b border-slate-800/60' : ''}`}>
              <div className="w-24 text-xs text-slate-500 flex-shrink-0 pt-0.5">{r.label}</div>
              <div className="text-sm text-slate-200 font-medium flex-1">{r.value}</div>
            </div>
          ))}
          <button onClick={() => del(w.id)} disabled={deleting}
            className="w-full mt-4 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50">
            {deleting ? <><Icon name="refresh" cls="w-4 h-4 spin" /> 刪除中…</> : <><Icon name="trash" cls="w-4 h-4" /> 刪除此人員資料</>}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div><h2 className="font-black text-white">人員名冊</h2><p className="text-slate-500 text-xs">顯示 {filtered.length} / 共 {workers.length} 筆</p></div>
      <div className="relative">
        <Icon name="search" cls="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-slate-200 placeholder-slate-500 text-sm focus:outline-none focus:border-orange-500/50"
          placeholder="搜尋姓名、身分證、電話…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <select className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-slate-300 text-sm focus:outline-none"
        value={filterCo} onChange={e => setFilterCo(e.target.value)}>
        <option value="">全部包商</option>
        {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {filtered.length === 0
        ? <div className="text-center py-12"><Icon name="user" cls="w-12 h-12 text-slate-700 mx-auto mb-3" /><p className="text-slate-600">查無人員資料</p></div>
        : filtered.map(w => (
          <button key={w.id} onClick={() => setSelected(w)}
            className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-3 flex items-center gap-3 text-left active:scale-95 transition-all hover:border-slate-700">
            <div className="w-12 h-14 rounded-xl overflow-hidden bg-slate-800 border border-slate-700 flex-shrink-0 flex items-center justify-center">
              {w.photoUrl
                ? <img src={w.photoUrl} className="w-full h-full object-cover" alt={w.name} />
                : <Icon name="user" cls="w-6 h-6 text-slate-600" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-white text-sm">{w.name}</div>
              <div className="text-orange-400 text-xs">{w.jobTitle}</div>
              <div className="text-slate-500 text-xs">{getName(w.contractorId)}</div>
            </div>
            <Icon name="chevron" cls="w-4 h-4 text-slate-600 flex-shrink-0" />
          </button>
        ))
      }
    </div>
  );
}

// ── Settings Tab ────────────────────────────────────────────────
function SettingsTab({ adminPass, setAdminPass, showToast, setView }) {
  const [np, setNp] = useState('');
  const [cp, setCp] = useState('');

  const changePass = () => {
    if (np.length < 4) { showToast('密碼至少 4 碼', 'error'); return; }
    if (np !== cp) { showToast('兩次密碼不一致', 'error'); return; }
    setAdminPass(np); setNp(''); setCp('');
    showToast('密碼已更新');
  };

  const resetUrl = () => {
    if (!confirm('確定要重新設定 Apps Script 網址？')) return;
    localStorage.removeItem(LS_URL);
    if (API.hasDefaultUrl()) {
      location.reload();
      return;
    }
    setView('setup');
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
        <h3 className="font-black text-white">修改管理密碼</h3>
        <Field label="新密碼">
          <input type="password" className={iCls()} placeholder="至少 4 碼" value={np} onChange={e => setNp(e.target.value)} />
        </Field>
        <Field label="確認新密碼">
          <input type="password" className={iCls()} placeholder="再次輸入" value={cp} onChange={e => setCp(e.target.value)} />
        </Field>
        <button onClick={changePass} className="w-full bg-orange-600 text-white rounded-xl py-3 text-sm font-bold active:scale-95 transition-all">更新密碼</button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <h3 className="font-black text-white mb-3">Google 雲端設定</h3>
        <p className="text-slate-500 text-xs mb-3">Apps Script 網址：{API.getUrl() ? '✓ 已設定' : '未設定'}</p>
        <button onClick={resetUrl}
          className="w-full bg-slate-800 border border-slate-700 text-slate-300 rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2 active:scale-95 transition-all">
          <Icon name="link" cls="w-4 h-4" /> 重新設定網址
        </button>
      </div>
    </div>
  );
}
