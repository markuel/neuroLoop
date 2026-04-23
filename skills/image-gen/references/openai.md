# OpenAI GPT-image-2 — Image Generation Reference

## API call

```python
import base64
from openai import OpenAI

client = OpenAI()  # reads OPENAI_API_KEY from environment

response = client.images.generate(
    model="gpt-image-2",
    prompt=prompt,
    size=size,          # see supported resolutions below
    quality="high",     # "low" | "medium" | "high"
    output_format="jpeg",
    n=1,
)

# Response contains base64-encoded image data
image_bytes = base64.b64decode(response.data[0].b64_json)
with open(output_path, "wb") as f:
    f.write(image_bytes)
```

## API call — with reference images

When the user has uploaded product/character/style references, use `images.edit` instead. Pass one or more file handles as `image`.

```python
with open(reference_path, "rb") as ref:
    response = client.images.edit(
        model="gpt-image-2",
        image=ref,           # or a list of file handles for multiple refs
        prompt=prompt,       # describe the *output* — e.g. "the product on a table in a cyberpunk bar"
        size=size,
        quality="high",
        output_format="jpeg",
        n=1,
    )
image_bytes = base64.b64decode(response.data[0].b64_json)
```

The prompt in edit mode describes the desired output scene; the references provide the subject identity.

## Supported resolutions

| Size | Use case |
|---|---|
| `1024x1024` | Square — default, works for all keyframes |
| `1792x1024` | Landscape — better for panoramic scenes |
| `1024x1792` | Portrait — better for vertical compositions |

Pass as the `size` parameter.

## Quality levels

- `high` — best quality, slower, higher cost. Use this.
- `medium` — faster, acceptable for quick iterations.
- `low` — fastest, noticeable quality drop.

## Rate limits

- 5 requests/minute on Tier 1
- 50 requests/minute on Tier 2+
- If you hit a rate limit, wait 12 seconds and retry.

## Prompt style guidance

GPT-image-1 has the strongest prompt adherence of all available models. It follows complex, multi-clause prompts faithfully.

**What works well:**
- Descriptive, specific scene descriptions
- Named artistic styles ("photorealistic DSLR", "cinematic color grading", "studio lighting")
- Explicit camera angle descriptions ("aerial view", "low-angle shot", "extreme close-up")
- Multiple subject elements in a single prompt

**Example prompt structure:**
```
[Primary subject], [environment/setting], [lighting condition], [camera angle/distance], [visual style], [quality modifier]
```

**Example:**
```
Dense ancient forest canopy seen from below looking up, shafts of golden sunlight breaking through layered green leaves, wide-angle lens distortion, photorealistic, 8K detail
```

**Avoid:**
- Prompts over ~400 words (truncation risk)
- Embedding text/words you want rendered in the image (unreliable)
- Contradictory lighting descriptions
