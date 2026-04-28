---
name: video-analysis
description: Runs TRIBE v2 on a final.mp4 to produce a brain activation score against a target state. Use this skill whenever you need to evaluate a generated video in the neuroLoop agent loop. Produces overall_score, per-segment scores, and mean activations per brain region.
---

# Video Analysis Skill

Runs TRIBE v2 on a generated video and compares the predicted brain activations against the target region map. Produces a `score.json` that the agent uses to decide whether to keep or discard an iteration.

## Running the script

```bash
python skills/video-analysis/scripts/score.py \
  --video agent/sessions/{SESSION_ID}/iterations/{N}/final.mp4 \
  --target agent/sessions/{SESSION_ID}/target_state.json \
  --output agent/sessions/{SESSION_ID}/iterations/{N}/score.json \
  --segment-duration {clip_seconds}
```

`--segment-duration` is the clip length from the video model (e.g., 8 for Veo, 5 for Seedance). This is used to align per-segment scores with the segment list.

## Output format

The script writes `score.json`:

```json
{
  "overall_score": 0.72,
  "segment_scores": [
    {"index": 0, "score": 0.81},
    {"index": 1, "score": 0.65},
    {"index": 2, "score": 0.70}
  ],
  "worst_segments": [1, 2],
  "mean_activations": {
    "V1": 0.45,
    "V2": 0.43,
    "MT": 0.81,
    "FFC": 0.12,
    "RSC": 0.67
  },
  "target_activations": {
    "V1": 0.50,
    "MT": 0.90,
    "RSC": 0.70
  },
  "region_deltas": {
    "V1": -0.05,
    "MT": -0.09,
    "RSC": -0.03
  }
}
```

- `overall_score` — weighted mean similarity to target across all regions and time, 0–1
- `segment_scores` — per-segment scores, sorted ascending (worst first in `worst_segments`)
- `worst_segments` — indices of the 1–2 lowest-scoring segments
- `mean_activations` — average normalized activation per region across the full video
- `target_activations` — the target values from `target_state.json` (for reference)
- `region_deltas` — `mean_activations - target_activations` per region (negative = under target)

## How to interpret the output

- Focus `worst_segments` for surgical edits — these are the candidates to regenerate
- `region_deltas` shows which brain regions are furthest from target — use this to redesign prompts
- If `overall_score` is above 0.85, the session target is met — stop
