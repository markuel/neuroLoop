# xAI Grok Imagine Video — Video Generation Reference

## Model ID

`grok-imagine-video` (via xAI API)

## API call

```python
import requests
import time
import base64
from pathlib import Path
import os

API_KEY = os.environ["XAI_API_KEY"]
BASE_URL = "https://api.x.ai/v1"

def encode_image(path: str) -> str:
    return base64.b64encode(Path(path).read_bytes()).decode()

# Submit the generation job
response = requests.post(
    f"{BASE_URL}/videos/generations",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "model": "grok-imagine-video",
        "prompt": motion_prompt,
        "first_frame_image": f"data:image/jpeg;base64,{encode_image(start_frame_path)}",
        "last_frame_image": f"data:image/jpeg;base64,{encode_image(end_frame_path)}",
        "duration": 10,           # seconds (up to 10)
        "resolution": "720p",
        "aspect_ratio": "16:9",
        "n": 1,
    },
)
response.raise_for_status()
job_id = response.json()["id"]

# Poll until complete
while True:
    status_resp = requests.get(
        f"{BASE_URL}/videos/generations/{job_id}",
        headers={"Authorization": f"Bearer {API_KEY}"},
    )
    status_resp.raise_for_status()
    job = status_resp.json()
    if job["status"] == "completed":
        break
    elif job["status"] == "failed":
        raise RuntimeError(f"Video generation failed: {job}")
    time.sleep(15)

# Download the video
video_url = job["videos"][0]["url"]
video_bytes = requests.get(video_url).content
Path(output_path).write_bytes(video_bytes)
```

## Clip parameters

| Parameter | Value |
|---|---|
| Clip duration | Up to 10 seconds |
| Aspect ratio | 16:9, 9:16, 1:1 |
| Max resolution | 720p |
| Output format | MP4 |

## Rate limits

- Default: ~5 concurrent jobs.
- Generation takes 60–120 seconds per clip.
- Poll no more frequently than every 15 seconds.

## Strengths

Grok Imagine Video produces high-realism natural scenes. It's best for:
- Outdoor environments (forests, oceans, mountains, cities)
- Cinematic slow-motion footage
- Human subjects in naturalistic settings
- Longer clips (up to 10 seconds vs. 5–8 for other models)

## Prompt tips

- Describe motion in concrete, physical terms: "waves rolling in from left to right", "branches swaying"
- Reference real cinematography techniques: "shallow depth of field", "long lens compression"
- Include atmosphere: "morning mist", "dramatic overcast lighting"

**Example:**
```
Slow aerial drift over golden wheat fields at dusk, long shadows stretching across the landscape, cinematic grade, photorealistic
```
