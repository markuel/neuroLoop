---
name: target-state
description: Translates a natural language description of a desired brain state into a concrete region activation map (target_state.json). Use this skill at the start of every neuroLoop agent session to convert the TARGET_DESCRIPTION into quantitative targets for specific brain regions.
---

# Target State Skill

Converts a natural language description of a desired brain state into a JSON map of target activation levels per HCP-MMP1 brain region. This is the ground truth that all subsequent scoring and prompt design is optimized toward.

## Running the script

```bash
python skills/target-state/scripts/translate.py \
  --description "heightened visual attention with a sense of spatial navigation" \
  --output agent/sessions/{SESSION_ID}/target_state.json
```

## Output format

```json
{
  "description": "heightened visual attention with a sense of spatial navigation",
  "regions": {
    "V1": 0.6,
    "V2": 0.6,
    "V3": 0.5,
    "V4": 0.4,
    "MT": 0.7,
    "MST": 0.6,
    "RSC": 0.9,
    "PHA1": 0.8,
    "PHA2": 0.7,
    "PHA3": 0.6
  },
  "primary_networks": ["early_visual", "motion", "scene_navigation"],
  "notes": "RSC and PHA targeted as primary scene/navigation regions. MT/MST for motion-driven attention. V1–V4 for perceptual load."
}
```

- `regions` — target activation level per region, 0–1. Only regions you want to actively target need to be listed; unlisted regions are treated as 0 (no target).
- `primary_networks` — coarse network labels for quick reference
- `notes` — rationale for the mapping

## How the mapping works

The script uses a lookup table of brain state descriptions → region activations, plus a language model call to handle novel descriptions. The HCP-MMP1 atlas has 360 regions across 22 fine networks — the script maps descriptions to the most relevant subset.

## Reference: description → region mapping

| Description keyword | Targeted regions |
|---|---|
| visual attention, perceptual load | V1, V2, V3, V4 |
| motion, optical flow, speed | MT, MST, V6, V3A |
| faces, people, social | FFC, STV, FFA |
| navigation, spatial, places | RSC, PHA1, PHA2, PHA3 |
| memory, default mode | PCC, mPFC, angular gyrus |
| language, words | STSva, STSda, TE1a |
| emotion, arousal | amygdala, insula |
| executive control | dlPFC, ACC, IPS |
| body movement, tool use | somatomotor cortex, premotor |

Use this table as a starting point. Multiple keywords can be combined — their region sets are merged and activation levels are weighted by how central each keyword is to the description.
