#!/usr/bin/env bash
set -euo pipefail

CLASP_BIN="${CLASP_BIN:-/c/Users/楓根/AppData/Roaming/npm/clasp}"
FALLBACK_DEPLOYMENT_ID="AKfycbyDG624ArloMf42My3_Qd0Iop_Ey7saVwZFKCJsd25nlF2ha9enJ2BLS9vmBbBUidc"
FALLBACK_VERIFY_URL="https://script.google.com/macros/s/AKfycbyDG624ArloMf42My3_Qd0Iop_Ey7saVwZFKCJsd25nlF2ha9enJ2BLS9vmBbBUidc/exec"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$PROJECT_DIR/apps-script.config.json"
SYNC_ENV_SCRIPT="$PROJECT_DIR/scripts/sync-apps-script-env.mjs"
DEFAULT_DEPLOYMENT_ID="$FALLBACK_DEPLOYMENT_ID"
DEFAULT_VERIFY_URL="$FALLBACK_VERIFY_URL"

if [[ -f "$CONFIG_FILE" ]]; then
  mapfile -t CONFIG_VALUES < <(python - <<'PY' "$CONFIG_FILE"
import json, sys
from pathlib import Path
config = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
print(config.get('deploymentId', '').strip())
print(config.get('verifyUrl', '').strip())
PY
)
  [[ -n "${CONFIG_VALUES[0]:-}" ]] && DEFAULT_DEPLOYMENT_ID="${CONFIG_VALUES[0]}"
  [[ -n "${CONFIG_VALUES[1]:-}" ]] && DEFAULT_VERIFY_URL="${CONFIG_VALUES[1]}"
fi

DEPLOYMENT_ID="$DEFAULT_DEPLOYMENT_ID"
VERIFY_URL="$DEFAULT_VERIFY_URL"
VERIFY=1
DRY_RUN=0
DESCRIPTION=""

usage() {
  cat <<'EOF'
用法:
  ./deploy-appscript.sh [版本描述]
  ./deploy-appscript.sh --description "描述"
  ./deploy-appscript.sh --deployment-id <deployment_id>
  ./deploy-appscript.sh --verify-url <exec_url>
  ./deploy-appscript.sh --no-verify
  ./deploy-appscript.sh --dry-run

說明:
  1. clasp push
  2. 建立 Apps Script 新版本
  3. 將指定 deployment redeploy 到新版本
  4. 以 GET 驗證 /exec 是否可回應

環境變數覆寫:
  CLASP_BIN      clasp 執行檔路徑
  DEPLOYMENT_ID  預設 deployment id
  VERIFY_URL     預設驗證網址
EOF
}

run_cmd() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    -d|--description)
      [[ $# -ge 2 ]] || { echo "缺少 --description 參數" >&2; exit 1; }
      DESCRIPTION="$2"
      shift 2
      ;;
    --deployment-id)
      [[ $# -ge 2 ]] || { echo "缺少 --deployment-id 參數" >&2; exit 1; }
      DEPLOYMENT_ID="$2"
      shift 2
      ;;
    --verify-url)
      [[ $# -ge 2 ]] || { echo "缺少 --verify-url 參數" >&2; exit 1; }
      VERIFY_URL="$2"
      shift 2
      ;;
    --no-verify)
      VERIFY=0
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    *)
      if [[ -z "$DESCRIPTION" ]]; then
        DESCRIPTION="$1"
        shift
      else
        echo "未知參數: $1" >&2
        usage >&2
        exit 1
      fi
      ;;
  esac
done

DEPLOYMENT_ID="${DEPLOYMENT_ID:-$DEFAULT_DEPLOYMENT_ID}"
VERIFY_URL="${VERIFY_URL:-$DEFAULT_VERIFY_URL}"
DESCRIPTION="${DESCRIPTION:-workerslist deploy $(date '+%Y-%m-%d %H:%M:%S')}"

cd "$PROJECT_DIR"

for required in appsscript.json Code.js; do
  [[ -f "$required" ]] || { echo "缺少必要檔案: $required" >&2; exit 1; }
done

[[ -x "$CLASP_BIN" ]] || { echo "找不到 clasp: $CLASP_BIN" >&2; exit 1; }

echo "==> Project: $PROJECT_DIR"
echo "==> Deployment ID: $DEPLOYMENT_ID"
echo "==> Description: $DESCRIPTION"

echo "==> 1/4 clasp push"
run_cmd "$CLASP_BIN" push

echo "==> 2/4 create version"
if [[ "$DRY_RUN" == "1" ]]; then
  VERSION_NUMBER="<dry-run>"
  run_cmd "$CLASP_BIN" version "$DESCRIPTION"
else
  VERSION_OUTPUT="$($CLASP_BIN version "$DESCRIPTION")"
  echo "$VERSION_OUTPUT"
  VERSION_NUMBER="$(printf '%s\n' "$VERSION_OUTPUT" | grep -oE '[0-9]+' | tail -1)"
  [[ -n "$VERSION_NUMBER" ]] || { echo "無法解析版本號" >&2; exit 1; }
fi

echo "==> 3/4 deploy version ${VERSION_NUMBER} to existing live deployment"
run_cmd "$CLASP_BIN" deploy -i "$DEPLOYMENT_ID" -V "$VERSION_NUMBER" -d "$DESCRIPTION"

echo "==> 4/4 verify"
if [[ "$VERIFY" == "1" ]]; then
  if [[ "$DRY_RUN" == "1" ]]; then
    run_cmd curl -fsSL "$VERIFY_URL"
  else
    VERIFY_RESPONSE="$(curl -fsSL "$VERIFY_URL")"
    printf '%s\n' "$VERIFY_RESPONSE"
  fi
else
  echo "略過驗證"
fi

if [[ "$DRY_RUN" != "1" ]]; then
  echo "==> sync frontend Apps Script config"
  python - <<'PY' "$CONFIG_FILE" "$DEPLOYMENT_ID" "$VERIFY_URL"
import json, sys
from pathlib import Path
config_path = Path(sys.argv[1])
deployment_id = sys.argv[2].strip()
verify_url = sys.argv[3].strip()
config = {}
if config_path.exists():
    config = json.loads(config_path.read_text(encoding='utf-8'))
config['deploymentId'] = deployment_id
config['verifyUrl'] = verify_url
config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding='utf-8')
PY
  if [[ -f "$SYNC_ENV_SCRIPT" ]]; then
    node "$SYNC_ENV_SCRIPT"
  fi
fi

echo "完成。"
