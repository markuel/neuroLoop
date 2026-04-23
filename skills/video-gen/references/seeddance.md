# Seedance 2.0 (ByteDance via Replicate) — Video Generation Reference

## Model ID

`bytedance/seedance-2.0` on Replicate

## API call

```python
import replicate
import urllib.request
from pathlib import Path

def image_to_data_uri(path: str) -> str:
    data = Path(path).read_bytes()
    import base64
    b64 = base64.b64encode(data).decode()
    return f"data:image/jpeg;base64,{b64}"

output = replicate.run(
    "bytedance/seedance-2.0",
    input={
        "prompt": motion_prompt,
        "image": image_to_data_uri(start_frame_path),     # start keyframe
        "last_image": image_to_data_uri(end_frame_path),  # end keyframe
        "duration": 5,          # 5 or 10 seconds
        "resolution": "1080p",  # "480p" | "720p" | "1080p"
        "aspect_ratio": "16:9",
    },
)

# output is a URL string pointing to the generated video
video_url = output if isinstance(output, str) else output[0]
urllib.request.urlretrieve(video_url, output_path)
```

## Clip parameters

| Parameter | Value |
|---|---|
| Clip duration | 5 or 10 seconds |
| Aspect ratio | 16:9 recommended |
| Max resolution | 1080p |
| Output format | MP4 |

## Rate limits

- Replicate queues jobs; typical latency is 30–90 seconds per clip.
- No hard per-minute limit, but keep concurrent jobs under 5 to avoid queue backup.

## Strengths

Seedance 2.0 has the strongest start/end keyframe adherence of all available models — it reliably interpolates between the two images. Use this model when:
- Precise frame-to-frame continuity is critical
- You have clear, visually distinct start and end keyframes
- You want controlled, predictable motion

## Prompt tips

- Describe the interpolation explicitly: what transforms from the start to the end state
- Camera motion descriptions work well: "smooth push-in", "lateral tracking"
- Seedance respects both the prompt and the keyframes — if they conflict, keyframes win
- Short, direct prompts work better than long descriptive ones here

**Example:**
```
Camera slowly drifts forward through underwater coral garden, schools of fish parting around the lens, soft caustic light patterns
```
