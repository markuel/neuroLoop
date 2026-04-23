#!/usr/bin/env bash
# Launch a neuroLoop agent session.
# Usage: bash agent/run.sh
set -euo pipefail

# Load model choices from .env
if [ -f .env ]; then
  set -a; source .env; set +a
else
  echo "No .env found — run bash setup.sh first."
  exit 1
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

echo ""
echo -e "${RED}${BOLD}  neuroLoop Agent${NC}"
echo -e "${DIM}  autonomous brain-state optimization loop${NC}"
echo ""

# ── Session parameters ───────────────────────────────────────────
read -rp "  Target brain state (describe the feeling or goal): " TARGET_DESCRIPTION
if [ -z "$TARGET_DESCRIPTION" ]; then
  echo "Target description is required."
  exit 1
fi

echo ""
echo -e "  Duration:  ${BOLD}[1]${NC} 30s   ${BOLD}[2]${NC} 45s   ${BOLD}[3]${NC} 60s"
read -rp "  Choose [1/2/3] (default: 1): " _dur_choice
case "${_dur_choice:-1}" in
  2) DURATION=45 ;;
  3) DURATION=60 ;;
  *) DURATION=30 ;;
esac

read -rp "  Max iterations (default: 20): " MAX_ITERATIONS
MAX_ITERATIONS=${MAX_ITERATIONS:-20}

read -rp "  Target score 0–1 (default: 0.85): " TARGET_SCORE
TARGET_SCORE=${TARGET_SCORE:-0.85}

SESSION_ID="session_$(date +%Y%m%d_%H%M%S)"

echo ""
echo -e "  ${GREEN}Starting session${NC} ${BOLD}${SESSION_ID}${NC}"
echo -e "  Target   : ${TARGET_DESCRIPTION}"
echo -e "  Duration : ${DURATION}s"
echo -e "  Models   : image=${IMAGE_MODEL:-?}  video=${VIDEO_MODEL:-?}"
echo -e "  Stop at  : ${MAX_ITERATIONS} iterations or score ≥ ${TARGET_SCORE}"
echo ""

# ── Hand off to Claude Code ──────────────────────────────────────
INITIAL_MESSAGE="$(cat <<MSG
SESSION_ID: ${SESSION_ID}
TARGET_DESCRIPTION: ${TARGET_DESCRIPTION}
DURATION: ${DURATION}
IMAGE_MODEL: ${IMAGE_MODEL}
VIDEO_MODEL: ${VIDEO_MODEL}
MAX_ITERATIONS: ${MAX_ITERATIONS}
TARGET_SCORE: ${TARGET_SCORE}

Read agent/system_prompt.md in full, then begin the session immediately.
MSG
)"

claude -p "$INITIAL_MESSAGE"
