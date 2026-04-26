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
# 1. Node.js  (needed before the config wizard)
# ------------------------------------------------------------------
step "Checking Node.js"

if ! command -v node &>/dev/null; then
  echo "  Installing Node.js..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  set +u
  nvm install --lts
  nvm use --lts
  set -u
fi
ok "node $(node --version)"

# ------------------------------------------------------------------
# 2. Config wizard  (Clack — arrow keys, proper password masking)
# ------------------------------------------------------------------
echo ""
npm install --prefix scripts --silent 2>/dev/null
node scripts/setup-wizard.mjs "$@"

# Source the .env the wizard wrote (or already existed)
set -a; source .env; set +a

# ------------------------------------------------------------------
# 3. uv + Python environment
# ------------------------------------------------------------------
step "Installing Python dependencies"

if ! command -v uv &>/dev/null; then
  echo "  Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
ok "uv $(uv --version)"

uv venv .venv --python 3.11 -q
source .venv/bin/activate

uv pip install -e ".[plotting]" -q
uv pip install -r dashboard/backend/requirements.txt -q
uv pip install -q openai google-genai replicate anthropic
ok "Python dependencies installed"

# ------------------------------------------------------------------
# 4. Frontend dependencies
# ------------------------------------------------------------------
step "Installing frontend dependencies"

echo "  Installing frontend packages..."
cd dashboard/frontend && npm install --silent && cd ../..
ok "Frontend dependencies installed"

# ------------------------------------------------------------------
# 5. Claude Code
# ------------------------------------------------------------------
step "Setting up Claude Code"

if ! command -v claude &>/dev/null; then
  echo "  Installing Claude Code..."
  curl -fsSL https://claude.ai/install.sh | bash
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

# Symlink each skill into .claude/skills/ so Claude Code auto-discovers them
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
# 6. HuggingFace login + TRIBE v2 model download
# ------------------------------------------------------------------
step "Downloading TRIBE v2 model"

if [ -n "${HF_TOKEN:-}" ]; then
  huggingface-cli login --token "$HF_TOKEN" 2>/dev/null || true
  echo "  Downloading weights (this takes a few minutes on first run)..."
  python -c "
from huggingface_hub import hf_hub_download
hf_hub_download('facebook/tribev2', 'config.yaml', local_dir='./cache/facebook/tribev2')
hf_hub_download('facebook/tribev2', 'best.ckpt',   local_dir='./cache/facebook/tribev2')
"
  ok "TRIBE v2 model ready"
else
  warn "HF_TOKEN not set — skipping model download"
  warn "Re-run bash setup.sh --reconfigure to enter your token"
fi

# ------------------------------------------------------------------
# 7. Mesh + atlas data
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
# 8. Launch
# ------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}  Setup complete.${NC}"
echo ""
echo -e "  Image model : ${BOLD}${IMAGE_MODEL:-not set}${NC}"
echo -e "  Video model : ${BOLD}${VIDEO_MODEL:-not set}${NC}"
echo -e "  Storage     : ${BOLD}${STORAGE_MODE:-local}${NC}"
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
