# Google Veo 3 — Video Generation Reference

## Model ID

`veo-3.0-generate-preview` (via Gemini API)

## API call

```python
import time
import base64
from pathlib import Path
from google import genai
from google.genai import types

client = genai.Client()  # reads GEMINI_API_KEY from environment

def load_image(path: str) -> types.Image:
    data = Path(path).read_bytes()
    mime = "image/jpeg"
    return types.Image(image_bytes=data, mime_type=mime)

# Start the generation operation
operation = client.models.generate_videos(
    model="veo-3.0-generate-preview",
    prompt=motion_prompt,
    image=load_image(start_frame_path),       # first frame
    config=types.GenerateVideosConfig(
        duration_seconds=8,                   # 5–8 supported
        aspect_ratio="16:9",                  # "16:9" | "9:16" | "1:1"
        number_of_videos=1,
        # last_frame=load_image(end_frame_path),  # end frame (if supported in your API tier)
    ),
)

# Poll until complete (typically 2–5 minutes)
while not operation.done:
    time.sleep(20)
    operation = client.operations.get(operation)

video_bytes = operation.result.generated_videos[0].video.video_bytes
Path(output_path).write_bytes(video_bytes)
```

**Note on end frame**: The `last_frame` parameter may require a higher API tier. If unavailable, use only `image` (start frame) and describe the desired ending in the motion prompt. The rolling window design means adjacent segments share a keyframe, so continuity is maintained even without explicit end-frame pinning.

## Clip parameters

| Parameter | Value |
|---|---|
| Clip duration | 5–8 seconds (default: 8) |
| Aspect ratio | 16:9 recommended for video |
| Max resolution | 1080p |
| Output format | MP4 |

## Rate limits

- Operations are long-running (2–5 min per clip).
- Default quota: ~10 concurrent operations.
- Do not poll more frequently than every 15 seconds.

## Prompt tips

Veo 3 produces the most cinematic motion quality of all available models. It responds well to:
- Cinematography vocabulary: "rack focus", "dolly zoom", "crane shot", "handheld"
- Physics descriptions: "water rippling outward", "leaves cascading in slow motion"
- Lighting transitions: "golden light sweeping across the scene"
- Speed qualifiers: "ultra slow motion", "real-time", "time-lapse"

**Avoid**: Requests for on-screen text, rapid scene cuts (this is one continuous clip), or highly abstract motion descriptions.
