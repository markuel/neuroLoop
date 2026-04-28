# Google Veo Video Generation Reference

## Model ID

Default: `veo-3.1-generate-preview` via Gemini API.

Override with `VEO_MODEL_ID` if you want a specific Google model, for example
`veo-2.0-generate-001` or `veo-3.1-generate-001`.

## API call

```python
import os
import time
from pathlib import Path
from google import genai
from google.genai import types

client = genai.Client()  # reads GEMINI_API_KEY from environment
model_id = os.environ.get("VEO_MODEL_ID", "veo-3.1-generate-preview")

def load_image(path: str) -> types.Image:
    data = Path(path).read_bytes()
    mime = "image/png" if Path(path).suffix.lower() == ".png" else "image/jpeg"
    return types.Image(image_bytes=data, mime_type=mime)

# Start the generation operation
operation = client.models.generate_videos(
    model=model_id,
    prompt=motion_prompt,
    image=load_image(start_frame_path),        # first frame
    config=types.GenerateVideosConfig(
        duration_seconds=8,                    # 5-8 supported for Veo 2; 4/6/8 for Veo 3.1
        aspect_ratio="16:9",                   # "16:9" | "9:16"
        number_of_videos=1,
        last_frame=load_image(end_frame_path), # ending frame / interpolation target
    ),
)

# Poll until complete (typically 2-5 minutes)
while not operation.done:
    time.sleep(20)
    operation = client.operations.get(operation)

video_bytes = operation.result.generated_videos[0].video.video_bytes
Path(output_path).write_bytes(video_bytes)
```

## First/last frame support

Google's current documentation shows first-and-last-frame generation for Veo on
Vertex AI, including Veo 2, and the Gemini API exposes `last_frame` /
`lastFrame` in `GenerateVideosConfig` for frame-specific generation.

The rolling-window design should pass `frame_i` as `image` and `frame_i+1` as
`last_frame` so each generated clip interpolates between the planned keyframes.

## Clip parameters

| Parameter | Value |
|---|---|
| Clip duration | 5-8 seconds for Veo 2; 4, 6, or 8 seconds for Veo 3.1 |
| Aspect ratio | 16:9 recommended for video |
| Output format | MP4 |

## Rate limits

- Operations are long-running (2-5 min per clip).
- Google documents concurrent operation limits by model and account tier.
- Do not poll more frequently than every 15 seconds.

## Prompt tips

Veo responds well to:
- Cinematography vocabulary: "rack focus", "dolly zoom", "crane shot", "handheld"
- Physics descriptions: "water rippling outward", "leaves cascading in slow motion"
- Lighting transitions: "golden light sweeping across the scene"
- Speed qualifiers: "ultra slow motion", "real-time", "time-lapse"

When using first and last frames, describe the transition between the two frames
instead of restating both static images. The model already sees the endpoints.

Avoid requests for on-screen text, rapid scene cuts, or highly abstract motion
descriptions.
