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

# Show first 4 + dots + last 4 so the user can verify the paste without revealing the full key
mask_key() {
  local val="$1"
  local len=${#val}
  if [ $len -eq 0 ]; then
    echo "(empty)"
  elif [ $len -le 8 ]; then
    printf '•%.0s' $(seq 1 $len)
  else
    local dots=$(( len - 8 ))
    printf '%s%s%s' "${val:0:4}" "$(printf '•%.0s' $(seq 1 $dots))" "${val: -4}"
  fi
}

# ------------------------------------------------------------------
# Banner
# ------------------------------------------------------------------
echo ""
echo -e "${RED}${BOLD}  neuroLoop${NC} — brain activity visualization"
echo -e "${DIM}  powered by Meta TRIBE v2${NC}"
echo ""

# ------------------------------------------------------------------
# Config wizard — skip if .env already exists (unless --reconfigure)
# ------------------------------------------------------------------
RECONFIGURE=false
for arg in "$@"; do
  [ "$arg" = "--reconfigure" ] && RECONFIGURE=true
done

if [ -f .env ] && [ "$RECONFIGURE" = false ]; then
  ok ".env found — skipping configuration wizard"
  echo -e "  ${DIM}Run ${NC}bash setup.sh --reconfigure${DIM} to change settings${NC}"
  set -a; source .env; set +a
else
  echo -e "${BOLD}Let's get you set up. This will only take a minute.${NC}"

  # ── HuggingFace token ──────────────────────────────────────────
  step "Step 1 of 6 — HuggingFace Token"
  echo -e "  TRIBE v2 is a gated model. Get a token at:"
  echo -e "  ${DIM}https://huggingface.co/settings/tokens${NC}"
  echo -e "  Then accept the model license at:"
  echo -e "  ${DIM}https://huggingface.co/facebook/tribev2${NC}"
  echo ""
  read -rsp "  Token: " HF_TOKEN
  echo ""
  echo -e "  ${DIM}$(mask_key "$HF_TOKEN")${NC}"
  if [ -z "$HF_TOKEN" ]; then
    warn "No token entered — model download will fail. Re-run setup.sh --reconfigure to fix this."
  else
    ok "Token saved"
  fi

  # ── Storage mode ───────────────────────────────────────────────
  step "Step 2 of 6 — Storage"
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

  # ── Anthropic API key ──────────────────────────────────────────
  step "Step 3 of 6 — Anthropic API Key"
  echo "  The agent loop runs on Claude Code. It needs an Anthropic API key."
  echo -e "  Get one at: ${DIM}https://console.anthropic.com/settings/keys${NC}"
  echo ""
  read -rsp "  Anthropic API key: " ANTHROPIC_API_KEY
  echo ""
  echo -e "  ${DIM}$(mask_key "$ANTHROPIC_API_KEY")${NC}"
  if [ -z "$ANTHROPIC_API_KEY" ]; then
    warn "No key entered — the agent loop won't work. Re-run setup.sh --reconfigure to fix this."
  else
    ok "Anthropic API key saved"
  fi

  # ── Image model ────────────────────────────────────────────────
  step "Step 4 of 6 — Image Generation Model"
  echo "  Which model should the agent use to generate keyframe images?"
  echo ""
  echo -e "  ${BOLD}[1] OpenAI GPT-image-2${NC}       ${DIM}Best prompt adherence, complex scenes${NC}"
  echo -e "  ${BOLD}[2] Gemini 3.1 Flash Image${NC}   ${DIM}Fast, vivid, abstract/stylized${NC}"
  echo -e "  ${BOLD}[3] Grok Imagine Image${NC}        ${DIM}Highly photorealistic, natural scenes${NC}"
  echo ""
  read -rp "  Choose [1/2/3] (default: 1): " _img_choice
  _img_choice=${_img_choice:-1}

  OPENAI_API_KEY=""
  GEMINI_API_KEY=""
  XAI_API_KEY=""

  case "$_img_choice" in
    1)
      IMAGE_MODEL=openai
      echo ""
      read -rsp "  OpenAI API key: " OPENAI_API_KEY
      echo ""
      echo -e "  ${DIM}$(mask_key "$OPENAI_API_KEY")${NC}"
      ok "Image model: GPT-image-2"
      ;;
    2)
      IMAGE_MODEL=gemini
      echo ""
      read -rsp "  Google Gemini API key: " GEMINI_API_KEY
      echo ""
      echo -e "  ${DIM}$(mask_key "$GEMINI_API_KEY")${NC}"
      ok "Image model: Gemini 3.1 Flash Image"
      ;;
    3)
      IMAGE_MODEL=grok
      echo ""
      read -rsp "  xAI API key: " XAI_API_KEY
      echo ""
      echo -e "  ${DIM}$(mask_key "$XAI_API_KEY")${NC}"
      ok "Image model: Grok Imagine Image"
      ;;
    *)
      IMAGE_MODEL=openai
      warn "Invalid choice — defaulting to OpenAI"
      read -rsp "  OpenAI API key: " OPENAI_API_KEY
      echo ""
      echo -e "  ${DIM}$(mask_key "$OPENAI_API_KEY")${NC}"
      ;;
  esac

  # ── Video model ────────────────────────────────────────────────
  step "Step 5 of 6 — Video Generation Model"
  echo "  Which model should the agent use to generate video segments?"
  echo ""
  echo -e "  ${BOLD}[1] Veo 3${NC}          ${DIM}(Google) Best motion quality, 8s clips${NC}"
  echo -e "  ${BOLD}[2] Seedance 2.0${NC}   ${DIM}(ByteDance via Replicate) Strong keyframe adherence, 5s clips${NC}"
  echo -e "  ${BOLD}[3] Grok Imagine${NC}   ${DIM}(xAI) High realism, 10s clips${NC}"
  echo ""
  read -rp "  Choose [1/2/3] (default: 1): " _vid_choice
  _vid_choice=${_vid_choice:-1}

  REPLICATE_API_KEY=""

  case "$_vid_choice" in
    1)
      VIDEO_MODEL=veo
      if [ -z "$GEMINI_API_KEY" ]; then
        echo ""
        read -rsp "  Google Gemini API key: " GEMINI_API_KEY
        echo ""
      fi
      ok "Video model: Veo 3"
      ;;
    2)
      VIDEO_MODEL=seeddance
      echo ""
      read -rsp "  Replicate API key: " REPLICATE_API_KEY
      echo ""
      echo -e "  ${DIM}$(mask_key "$REPLICATE_API_KEY")${NC}"
      ok "Video model: Seedance 2.0"
      ;;
    3)
      VIDEO_MODEL=grok-video
      if [ -z "$XAI_API_KEY" ]; then
        echo ""
        read -rsp "  xAI API key: " XAI_API_KEY
        echo ""
      fi
      ok "Video model: Grok Imagine Video"
      ;;
    *)
      VIDEO_MODEL=veo
      warn "Invalid choice — defaulting to Veo 3"
      if [ -z "$GEMINI_API_KEY" ]; then
        read -rsp "  Google Gemini API key: " GEMINI_API_KEY
        echo ""
      fi
      ;;
  esac

  # ── Write .env ─────────────────────────────────────────────────
  step "Step 6 of 6 — Saving configuration"

  cat > .env <<EOF
# Storage
STORAGE_MODE=${STORAGE_MODE}

# S3 settings (only used when STORAGE_MODE=s3)
S3_BUCKET=${S3_BUCKET}
AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION}
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}

# TRIBE v2
HF_TOKEN=${HF_TOKEN}

# Agent — Claude Code
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}

# Agent — model selection
IMAGE_MODEL=${IMAGE_MODEL}
VIDEO_MODEL=${VIDEO_MODEL}

# Agent — provider API keys (only the chosen models need to be set)
OPENAI_API_KEY=${OPENAI_API_KEY}
GEMINI_API_KEY=${GEMINI_API_KEY}
XAI_API_KEY=${XAI_API_KEY}
REPLICATE_API_KEY=${REPLICATE_API_KEY}
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

# Agent skill dependencies
uv pip install -q \
  openai \
  google-genai \
  replicate \
  anthropic
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
# 4. Claude Code
# ------------------------------------------------------------------
step "Setting up Claude Code"

if ! command -v claude &>/dev/null; then
  echo "  Installing Claude Code..."
  curl -fsSL https://claude.ai/install.sh | bash
  # Pick up the binary from wherever the installer put it
  export PATH="$HOME/.local/bin:$HOME/.anthropic/bin:$PATH"
fi
ok "Claude Code $(claude --version 2>/dev/null | head -1)"

# Project-level settings: bypass all permission prompts (safe — isolated GPU instance)
mkdir -p .claude/skills
cat > .claude/settings.json <<'SETTINGS'
{
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}
SETTINGS
ok "Claude Code configured (bypassPermissions)"

# Symlink each skill into .claude/skills/ so Claude Code discovers them
_linked=0
for skill_dir in skills/*/; do
  skill_name=$(basename "$skill_dir")
  target=".claude/skills/$skill_name"
  if [ ! -e "$target" ]; then
    ln -sf "../../skills/$skill_name" "$target"
    _linked=$((_linked + 1))
  fi
done
_total=$(ls -d skills/*/ 2>/dev/null | wc -l | tr -d ' ')
ok "Skills linked (${_total} skills → .claude/skills/)"

# ------------------------------------------------------------------
# 5. HuggingFace login + model download
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
  warn "Re-run setup.sh --reconfigure and enter your token to download the model"
fi

# ------------------------------------------------------------------
# 6. Mesh + atlas data
# ------------------------------------------------------------------
step "Preparing brain data"

if [ ! -f dashboard/backend/data/fsaverage5_mesh.npz ] || [ ! -f dashboard/backend/data/hcp_atlas.npz ]; then
  echo "  Generating mesh + atlas..."
  mkdir -p "$HOME/mne_data"
  python scripts/bundle_mesh.py
  ok "Mesh and atlas generated"
else
  ok "Mesh and atlas already present"
fi

python -c "from nilearn.datasets import fetch_surf_fsaverage; fetch_surf_fsaverage('fsaverage5')" 2>/dev/null \
  && ok "fsaverage5 cached" \
  || warn "fsaverage5 pre-cache failed — will retry at runtime"

# ------------------------------------------------------------------
# 7. Launch
# ------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}  Setup complete.${NC}"
echo ""
echo -e "  Image model : ${BOLD}${IMAGE_MODEL:-not set}${NC}"
echo -e "  Video model : ${BOLD}${VIDEO_MODEL:-not set}${NC}"
echo -e "  Storage     : ${BOLD}${STORAGE_MODE:-local}${NC}"
echo ""
echo -e "  Open ${BOLD}http://localhost:5173${NC} in your browser once servers start."
echo -e "  Run ${BOLD}claude${NC} in this directory to start the agent loop."
echo ""

cd dashboard/backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ../..

cd dashboard/frontend
npm run dev -- --host 0.0.0.0

kill $BACKEND_PID 2>/dev/null
