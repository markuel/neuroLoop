# neuroLoop — Claude Code Project

## What this is

neuroLoop generates videos optimized to drive specific brain states, measured by TRIBE v2 fMRI predictions. It runs as an autonomous agent loop: generate → score → keep/discard → iterate.

## Structure

```
dashboard/          FastAPI backend + React/Three.js frontend
neuroLoop/          Python SDK: BrainAtlas, FINE_GROUPS, COARSE_GROUPS, TRIBE wrapper
agent/              Agent system prompt, model registry, session workspace
skills/             Claude Code skills: image-gen, video-gen, stitch-video, video-analysis, target-state
scripts/            One-time data prep (bundle_mesh.py)
```

## Running the agent loop

When the user provides session parameters (SESSION_ID, TARGET_DESCRIPTION, DURATION, IMAGE_MODEL, VIDEO_MODEL, MAX_ITERATIONS, TARGET_SCORE), read `agent/system_prompt.md` in full and follow those instructions exactly. Do not summarize or skip steps.

Brain region reference — read this before designing any prompts: `agent/brain_regions.md`

## SDK notes

- `neuroLoop.BrainAtlas` — maps TRIBE v2 vertex predictions to HCP-MMP1 region timeseries
- `neuroLoop.regions.FINE_GROUPS` — 22-network grouping (Glasser 2016)
- `neuroLoop.regions.COARSE_GROUPS` — 7-network grouping (Yeo 2011)
- Package is installed editable: `from neuroLoop import BrainAtlas` works in the venv
- Model weights at `cache/facebook/tribev2/`

## Skills

Skills live in `skills/` and are symlinked into `.claude/skills/`. Each has a `SKILL.md` and a `scripts/` directory. Read the skill's SKILL.md before using it — it tells you the exact script invocation and output format.
