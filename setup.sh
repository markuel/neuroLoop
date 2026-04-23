#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------------
# Colors
# ------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
step() { echo -e "\n${BOLD}$1${NC}"; }

# ------------------------------------------------------------------
# Banner
# ------------------------------------------------------------------
echo ""
echo -e "${RED}${BOLD}  neuroLoop${NC} — brain activity visualization"
echo -e "${DIM}  powered by Meta TRIBE v2${NC}"
echo ""

# ------------------------------------------------------------------
# Config wizard — skip if .env already exists
# ------------------------------------------------------------------
if [ -f .env ]; then
  ok ".env found — skipping configuration wizard"
  set -a; source .env; set +a
else
  echo -e "${BOLD}Let's get you set up. This will only take a minute.${NC}"

  # ── HuggingFace token ──────────────────────────────────────────
  step "Step 1 of 3 — HuggingFace Token"
  echo -e "  TRIBE v2 is a gated model. Get a token at:"
  echo -e "  ${DIM}https://huggingface.co/settings/tokens${NC}"
  echo -e "  Then accept the model license at:"
  echo -e "  ${DIM}https://huggingface.co/facebook/tribev2${NC}"
  echo ""
  read -rsp "  Token: " HF_TOKEN
  echo ""
  if [ -z "$HF_TOKEN" ]; then
    warn "No token entered — model download will fail. You can re-run setup.sh to fix this."
  else
    ok "Token saved"
  fi

  # ── Storage mode ───────────────────────────────────────────────
  step "Step 2 of 3 — Storage"
  echo "  Where should neuroLoop store uploaded files and results?"
  echo ""
  echo -e "  ${BOLD}[1] Local${NC}  — on this machine  ${DIM}(simplest, good for one GPU instance)${NC}"
  echo -e "  ${BOLD}[2] AWS S3${NC} — in an S3 bucket   ${DIM}(results persist if instance restarts)${NC}"
  echo ""
  read -rp "  Choose [1/2] (default: 1): " _storage_choice
  _storage_choice=${_storage_choice:-1}

  if [ "$_storage_choice" = "2" ]; then
    STORAGE_MODE=s3

    echo ""
    read -rp "  S3 bucket name: " S3_BUCKET

    read -rp "  AWS region [us-east-1]: " AWS_DEFAULT_REGION
    AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-us-east-1}

    read -rp "  AWS access key ID: " AWS_ACCESS_KEY_ID

    read -rsp "  AWS secret access key: " AWS_SECRET_ACCESS_KEY
    echo ""

    ok "S3 storage configured (bucket: $S3_BUCKET)"
  else
    STORAGE_MODE=local
    S3_BUCKET=""
    AWS_DEFAULT_REGION=""
    AWS_ACCESS_KEY_ID=""
    AWS_SECRET_ACCESS_KEY=""
    ok "Local storage selected"
  fi

  # ── Write .env ─────────────────────────────────────────────────
  step "Step 3 of 3 — Saving configuration"

  cat > .env <<EOF
STORAGE_MODE=${STORAGE_MODE}
HF_TOKEN=${HF_TOKEN}

# S3 settings (only used when STORAGE_MODE=s3)
S3_BUCKET=${S3_BUCKET}
AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION}
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
EOF

  set -a; source .env; set +a
  ok "Configuration written to .env"
fi

# ------------------------------------------------------------------
# 1. uv
# ------------------------------------------------------------------
step "Installing dependencies"

if ! command -v uv &>/dev/null; then
  echo "  Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
ok "uv $(uv --version)"

# ------------------------------------------------------------------
# 2. Python venv + deps
# ------------------------------------------------------------------
echo "  Setting up Python environment..."
uv venv .venv --python 3.11 -q
source .venv/bin/activate

uv pip install -e ".[plotting]" -q
uv pip install -r dashboard/backend/requirements.txt -q
ok "Python dependencies installed"

# ------------------------------------------------------------------
# 3. Node + frontend deps
# ------------------------------------------------------------------
if ! command -v node &>/dev/null; then
  echo "  Installing Node.js..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash -s -- --silent
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install --lts --silent
fi
ok "node $(node --version)"

echo "  Installing frontend dependencies..."
cd dashboard/frontend && npm install --silent && cd ../..
ok "Frontend dependencies installed"

# ------------------------------------------------------------------
# 4. HuggingFace login + model download
# ------------------------------------------------------------------
step "Downloading TRIBE v2 model"

if [ -n "${HF_TOKEN:-}" ]; then
  hf auth login --token "$HF_TOKEN" 2>/dev/null
  echo "  Downloading weights (this takes a few minutes on first run)..."
  python -c "
from huggingface_hub import hf_hub_download
hf_hub_download('facebook/tribev2', 'config.yaml', local_dir='./cache/facebook/tribev2')
hf_hub_download('facebook/tribev2', 'best.ckpt',   local_dir='./cache/facebook/tribev2')
"
  ok "TRIBE v2 model ready"
else
  warn "HF_TOKEN not set — skipping model download"
  warn "Re-run setup.sh and enter your token to download the model"
fi

# ------------------------------------------------------------------
# 5. Mesh + atlas data
# ------------------------------------------------------------------
step "Preparing brain data"

if [ ! -f dashboard/backend/data/fsaverage5_mesh.npz ] || [ ! -f dashboard/backend/data/hcp_atlas.npz ]; then
  echo "  Generating mesh + atlas..."
  python scripts/bundle_mesh.py
  ok "Mesh and atlas generated"
else
  ok "Mesh and atlas already present"
fi

python -c "from nilearn.datasets import fetch_surf_fsaverage; fetch_surf_fsaverage('fsaverage5')" 2>/dev/null \
  && ok "fsaverage5 cached" \
  || warn "fsaverage5 pre-cache failed — will retry at runtime"

# ------------------------------------------------------------------
# 6. Launch
# ------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}  Setup complete.${NC}"
echo ""
echo -e "  Open ${BOLD}http://localhost:5173${NC} in your browser once servers start."
echo ""

cd dashboard/backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ../..

cd dashboard/frontend
npm run dev -- --host 0.0.0.0

kill $BACKEND_PID 2>/dev/null
