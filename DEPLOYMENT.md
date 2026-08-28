# 施工人員名冊正式上線

## 權限設計

| 身分 | 可查看範圍 | 可執行操作 |
| --- | --- | --- |
| 公開登錄者 | 主承包商與次承包商名稱 | 送出一筆完整人員資料 |
| 次承包商管理者 | 自己次承包商的人員 | 新增、查看、修改、封存、匯出自己公司的 PDF |
| 主要管理者 | 主承包商及全部次承包商與人員 | 管理主承包商自有人員、完整管理、配發次管理者、跨公司報表、備份 |

主承包商由主要管理者直接管理，不配發次管理者。次承包商帳號的公司範圍由後端依登入帳號決定；前端傳入其他公司代碼時，後端仍會拒絕。

停用或隨承包商封存次管理者時，系統會撤銷該帳號對既有私有 PDF 連結的使用權。對方先前已下載到自己裝置的副本無法遠端收回，因此帳號與臨時密碼應分開傳送，離職或更換管理者時要立即停用帳號。

當 `SUPABASE_DATA_MODE=supabase` 時，人員、次承包商新增、報表與備份的主要操作都直接使用 Supabase，不會再把這些高頻資料操作送回 Apps Script。主承包商更名、承包商封存及登入、密碼、次管理者帳號仍保留在 Apps Script，因為這些是低頻的控制與帳號操作；待帳號也搬到 Supabase 後，才可完全移除 Apps Script。

## 一、準備三組密鑰

準備三組彼此不同的隨機字串，各至少 32 個字元：

- `GAS_PUBLIC_SECRET`：Netlify 公開登錄代理與 Apps Script 共用。
- `GAS_ADMIN_SECRET`：Netlify 與 Apps Script 共用。
- `SESSION_SECRET`：只放 Netlify，用來簽署登入工作階段。

請用密碼管理器產生並保存，不要貼在程式碼、GitHub 或 LINE 群組。

## 二、更新 Apps Script

建議先更新 Apps Script，再立刻重新部署 Netlify。兩次部署之間可能短暫顯示連線失敗，但可以先停止舊版公開名冊繼續暴露資料。

1. 開啟 [Google Apps Script](https://script.google.com/) 的原專案。
2. 先備份原本的 `Code.gs`，再將專案內容全部替換為本專案的 `Code.gs`。
3. 在「專案設定」將時區設為 `Asia/Taipei`。
   本版本的 `createManagerAdmin_` 與 `archiveContractorAdmin_` 會在需要時，把 Supabase 新增但尚未出現在 Google 試算表的次承包商補入「包商」工作表，讓原本的次管理者帳號與封存流程可以繼續使用。若要替新公司建立次管理者或封存新公司，必須先部署本版本的 `Code.gs`。
4. 在「專案設定 > 指令碼屬性」新增：

| 屬性 | 值 |
| --- | --- |
| `ADMIN_API_SECRET` | `GAS_ADMIN_SECRET` |
| `PUBLIC_API_SECRET` | `GAS_PUBLIC_SECRET` |
| `OWNER_EMAIL` | 主要管理者的 Google 帳號 Email |
| `OWNER_INITIAL_PASSWORD` | 至少 12 碼且含英文字母與數字 |
| `OWNER_DISPLAY_NAME` | 主要管理者姓名 |
| `PRIMARY_CONTRACTOR_NAME` | 要顯示於登錄頁及所有 PDF 抬頭的主承包商完整公司名稱 |

既有系統升級時，只需確認原有密鑰仍在，並新增或更新 `PRIMARY_CONTRACTOR_NAME`；不必重新建立 `OWNER_INITIAL_PASSWORD`。

5. 全新系統：執行 `setupSystemFromProperties`，依畫面授權。執行成功後，初始密碼會從指令碼屬性刪除。
6. 既有系統升級：不要重跑 `setupSystemFromProperties`；新增或更新 `PRIMARY_CONTRACTOR_NAME` 後，執行 `configurePrimaryContractorFromProperties`。若原本已把自己的公司建成一般承包商，系統會沿用相同公司紀錄及既有人員並改列為主承包商。
7. 執行 `migrateAndHardenExistingData`。這會將未分類的舊公司保留為次承包商、補齊舊資料欄位，並撤銷資料夾、資料庫與舊照片殘留的公開或直接共用權限。
8. 執行 `installDailyBackupTrigger`，建立每日備份。
9. 選擇「部署 > 管理部署作業 > 編輯」，建立新版本：
   - 執行身分：我
   - 存取權：所有人
10. 複製最後以 `/exec` 結尾的網路應用程式網址。

## 三、設定 Netlify

在 Netlify 網站的「Site configuration > Environment variables」新增：

| Key | Value | 是否勾選 Secret |
| --- | --- | --- |
| `APPS_SCRIPT_URL` | 同一個 Apps Script `/exec` 網址 | 否 |
| `GAS_PUBLIC_SECRET` | 與 Apps Script `PUBLIC_API_SECRET` 完全相同 | 是 |
| `GAS_ADMIN_SECRET` | 與 Apps Script `ADMIN_API_SECRET` 完全相同 | 是 |
| `SESSION_SECRET` | 第三組不同密鑰 | 是 |

不要再設定 `VITE_APPS_SCRIPT_URL` 或任何前端管理密碼。Apps Script 網址與兩組 Google 代理密鑰只由 Netlify Functions 讀取。

`netlify.toml` 已設定：

- Build command：`npm run build`
- Publish directory：`dist`
- Functions directory：`netlify/functions`
- Node.js：20

環境變數儲存後，到「Deploys > Trigger deploy」重新部署。環境變數或前端程式有修改時，都必須重新部署才會生效。

部署紀錄的 post-processing 階段應顯示兩條 code-based rate limiting 規則，分別保護 `/api/public` 與 `/api/admin`。

## 四、GitHub 應上傳的檔案

確認至少包含：

- `Code.gs`
- `index.html`
- `worker-registry-v2.jsx`
- `src/main.jsx`
- `src/index.css`
- `netlify/functions/admin-api.mjs`
- `netlify/functions/public-api.mjs`
- `netlify.toml`
- `package.json`
- `package-lock.json`
- `tailwind.config.js`
- `postcss.config.js`
- `vite.config.mjs`
- `.gitignore`

不要上傳 `.env`、密鑰、初始密碼、`node_modules` 或 `dist`。

## 五、首次登入與配發

1. 開啟正式網站，進入「管理登入」。
2. 使用 `OWNER_EMAIL` 與 `OWNER_INITIAL_PASSWORD` 登入。
3. 到「公司」確認主承包商完整公司名稱，並新增次承包商。
4. 到「次管理者」建立每家次承包商的管理帳號；主承包商不建立次管理者。
5. 系統會產生臨時密碼；請將帳號與臨時密碼分開傳送。
6. 次管理者第一次登入後，必須先更換密碼。

Supabase 模式的 PDF 會存放在私有 `registry-reports` 儲存空間，下載連結為限時簽名連結，不需要使用者登入 Google Drive。Google Drive 中的舊報表仍依原權限保留。

## 六、上線驗收

1. 未登入時只能看見主承包商與次承包商清單，不能查詢任何人員。
2. 確認主承包商也能在公開登錄及主要管理者新增人員時被選取。
3. 必填欄位逐一留白測試；姓名、證號、電話、緊急聯絡資料、血型、所屬公司及照片任一缺少都不能送出。
4. 輸入一組錯誤檢查碼的身分證或居留證號，確認前端會阻止送出。
5. 用 A 次承包商帳號登入，只能看見、修改及匯出 A 公司人員。
6. 用 B 次承包商帳號確認看不到 A 公司人員，也無法管理主承包商自有人員。
7. 主要管理者確認可查看主承包商及全部次承包商、建立帳號、產生每日與公司完整 PDF；Supabase 模式下報表不應再呼叫 Apps Script。
8. 確認每份 PDF 抬頭都有主承包商完整公司名稱，且人員標示為「主承包商自有人員」或「次承包商人員」。
9. 確認 PDF 含照片、證號、電話、緊急聯絡資料、血型、所屬公司、日期及完整備註。
10. 確認 Supabase Storage 的 `worker-photos` 與 `registry-reports` 都是私有空間，PDF 只能透過系統產生的限時連結開啟。
11. 在 LINE 內建瀏覽器測試拍照；相機未開啟時應顯示外部瀏覽器與複製連結選項。
12. 從瀏覽器開發工具確認前端資源中沒有 Apps Script 網址、管理密鑰或公開代理密鑰。
