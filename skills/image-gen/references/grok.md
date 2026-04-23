# xAI Grok Imagine Image — Image Generation Reference

## API call

```python
import requests
import base64
import os

API_KEY = os.environ["XAI_API_KEY"]

response = requests.post(
    "https://api.x.ai/v1/images/generations",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "model": "grok-imagine-image",
        "prompt": prompt,
        "n": 1,
        "size": size,          # see supported resolutions below
        "response_format": "b64_json",
    },
)
response.raise_for_status()

image_bytes = base64.b64decode(response.json()["data"][0]["b64_json"])
with open(output_path, "wb") as f:
    f.write(image_bytes)
```

## Supported resolutions

| Size | Notes |
|---|---|
| `1024x1024` | Standard square — recommended |
| `1280x768` | Landscape widescreen |

## Rate limits

- Varies by tier. Default: ~5 requests/minute.
- On 429, wait 15 seconds and retry.

## Prompt style guidance

Aurora produces highly detailed, photorealistic imagery. It is particularly strong for:
- Natural environments (forests, oceans, mountains, caves)
- Architectural interiors and exteriors
- Human subjects with accurate anatomy
- Material textures (rock, water, fabric, skin)

**What works well:**
- Photography-style descriptors ("shot on Canon EOS R5", "f/2.8 bokeh", "golden hour")
- Rich environmental detail ("moss-covered ancient ruins", "dappled light through oak canopy")
- Specific time-of-day and weather conditions

**Example:**
```
Coastal cliffside at blue hour, waves crashing against dark volcanic rock below, mist rising from the surf, shot on Sony A7R V with 24mm wide-angle lens, photorealistic, cinematic
```

**Avoid:**
- Highly abstract or conceptual prompts (Aurora tends literal)
- Cartoon or heavily stylized art directions (less reliable)
- Crowded scenes with many distinct named characters
