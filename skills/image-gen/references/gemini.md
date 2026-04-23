# Gemini 3.1 Flash Image (Nano Banana 2) — Image Generation Reference

## API call

```python
from google import genai
from google.genai import types
import base64

client = genai.Client()  # reads GEMINI_API_KEY from environment

response = client.models.generate_images(
    model="gemini-3.1-flash-image-preview",
    prompt=prompt,
    config=types.GenerateImagesConfig(
        number_of_images=1,
        output_mime_type="image/jpeg",
        aspect_ratio="1:1",   # see supported ratios below
    ),
)

image_bytes = response.generated_images[0].image.image_bytes
with open(output_path, "wb") as f:
    f.write(image_bytes)
```

## Supported resolutions / aspect ratios

Gemini image generation uses aspect ratios rather than pixel dimensions.

| Aspect ratio | Approximate output | Use case |
|---|---|---|
| `1:1` | ~1024x1024 | Default square keyframe |
| `16:9` | ~1024x576 | Widescreen video-like |
| `9:16` | ~576x1024 | Vertical |

Use `1:1` for standard keyframes.

## Rate limits

- 10 images/minute on free tier
- 60 images/minute on paid tier
- Retry after 6 seconds on 429.

## Prompt style guidance

Gemini Flash produces vivid, stylized imagery. It excels at:
- Abstract and surreal compositions
- High-saturation color worlds
- Stylized art directions (impressionist, watercolor, neon, etc.)
- Fast generation — good for exploratory iterations

It is less reliable than GPT-image-1 for highly specific architectural or technical accuracy.

**What works well:**
- Evocative, sensory language ("warm amber haze", "crystalline blue light")
- Art style anchors ("in the style of a National Geographic photo", "cinematic still")
- Mood-first descriptions

**Example:**
```
A vast ocean of bioluminescent plankton glowing electric blue under a starless sky, long exposure photography, ultra-detailed, National Geographic style
```

**Avoid:**
- Precise spatial layouts (e.g., "three objects in a triangle formation")
- Text or symbols in the image
- Expecting fine-grained face detail (less reliable than OpenAI)
