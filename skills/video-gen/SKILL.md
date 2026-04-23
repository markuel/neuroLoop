---
name: video-gen
description: Generates a single video segment from a start keyframe image, an end keyframe image, and a motion prompt. Use this skill whenever you need to produce a video clip as part of the neuroLoop agent loop. Handles Veo 3 (Google), Seedance 2.0 (ByteDance via Replicate), and Grok Imagine Video (xAI). Reads the correct model reference file automatically based on the selected model.
---

# Video Segment Generation Skill

This skill generates a single video segment between two keyframe images. Each segment is one step in the rolling-window pipeline: frame[i] → segment[i] → frame[i+1].

## Before generating

Read the reference file for the chosen model — it contains the exact API call, clip duration, resolution limits, and prompt tips for that model.

| Model | Reference file |
|---|---|
| veo | `skills/video-gen/references/veo.md` |
| seeddance | `skills/video-gen/references/seeddance.md` |
| grok-video | `skills/video-gen/references/grok-video.md` |

## What makes a good motion prompt

The motion prompt describes what happens *between* the two keyframe images. It should:

1. **Describe the camera movement** — "slow dolly forward", "rising crane shot", "handheld tracking shot"
2. **Describe subject motion** — what moves, how fast, in which direction
3. **Name the target brain regions** — not literally in the prompt, but let the target guide your motion choices:
   - MT, MST: fast optical flow, wide-field motion, moving camera
   - RSC, PHA: smooth navigation through a scene, architectural fly-through
   - FFC, STV: biological motion, a person walking or gesturing
   - V1–V4: high-contrast moving edges, flickering textures

**Prompt structure:**
```
[Camera motion], [subject motion or scene change], [speed/energy], [mood]
```

**Example:**
```
Slow tracking shot through ancient forest undergrowth, shafts of light shifting as branches sway, tranquil and immersive, cinematic motion blur
```

## Running the script

```bash
python skills/video-gen/scripts/generate.py \
  --model {veo|seeddance|grok-video} \
  --start-frame sessions/{SESSION_ID}/iterations/{N}/keyframes/frame_NN.jpg \
  --end-frame sessions/{SESSION_ID}/iterations/{N}/keyframes/frame_MM.jpg \
  --motion-prompt "your motion prompt here" \
  --output sessions/{SESSION_ID}/iterations/{N}/segments/seg_NN.mp4 \
  --duration {clip_seconds}
```

The `--duration` flag is passed for models that support variable clip length. For fixed-duration models it is ignored.

## Output

Video segments are saved as MP4 to the specified output path. Name them `seg_00.mp4`, `seg_01.mp4`, etc. in order.
