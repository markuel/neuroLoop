---
name: image-gen
description: Generates keyframe images for the neuroLoop agent loop. Use this skill whenever you need to generate a keyframe image from a prompt as part of the video generation pipeline. Handles OpenAI GPT-image-1, Gemini 2.0 Flash image generation, and xAI Aurora (Grok). Reads the correct model reference file automatically based on the selected model.
---

# Image Generation Skill

This skill generates individual keyframe images that will be used as start/end frames for video segment generation.

## Before generating

Read the reference file for the chosen model — it contains the exact API call, supported resolutions, rate limits, and prompt style guidance specific to that model.

| Model | Reference file |
|---|---|
| openai | `skills/image-gen/references/openai.md` |
| gemini | `skills/image-gen/references/gemini.md` |
| grok | `skills/image-gen/references/grok.md` |

## Writing effective keyframe prompts

A keyframe image needs to do two things simultaneously: (1) target the desired brain regions through its visual content, and (2) be composable with adjacent frames so video generation can interpolate smoothly between them.

**For brain targeting**, think about what visual properties activate each region:
- High spatial frequency detail and color contrast → early visual regions (V1–V4)
- Motion blur, directional streaks, dynamic scenes → motion regions (MT, MST)
- Human faces, bodies, biological motion → face/body regions (FFC, STV)
- Rich natural environments, landmarks → scene/navigation regions (RSC, PHA)

**For composability**, adjacent keyframes should share:
- A consistent color palette
- A spatial relationship (camera moving through the same environment)
- A mood or tone

**Prompt structure that works well:**
```
[Subject/scene], [action/state], [visual style], [lighting], [camera angle], photorealistic, 8K
```

**Avoid:**
- Text in the image (it won't survive video generation)
- Highly abstract or chaotic compositions (hard to interpolate)
- Completely unrelated scenes between adjacent frames

## Running the script

```bash
python skills/image-gen/scripts/generate.py \
  --model {openai|gemini|grok} \
  --prompt "your prompt here" \
  --output sessions/{SESSION_ID}/iterations/{N}/keyframes/frame_{NN}.jpg \
  --resolution 1024x1024
```

The script reads the appropriate API key from the environment automatically.

## Output

Images are saved as JPEG to the specified output path. Name them `frame_00.jpg`, `frame_01.jpg`, etc. in order.
