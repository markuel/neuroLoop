#!/usr/bin/env python3
"""Generate a single keyframe image using the specified model.

Optionally accepts one or more reference images (product photos, character refs,
style refs). When references are provided, the chosen model is instructed to
include the referenced subject/style in the generated keyframe.

Not all providers support references:
- openai: uses `images.edit` with the first reference (multi-ref via `image` list)
- gemini: passes references as image Parts in a multimodal `generate_content` call
- grok:   not supported — raises a clear error if references are passed
"""

import argparse
import base64
import os
import sys
from pathlib import Path


def generate_openai(prompt: str, resolution: str, output_path: Path, refs: list[Path]) -> None:
    from openai import OpenAI

    client = OpenAI()

    if refs:
        # images.edit takes one or more source images and a prompt describing the output.
        open_files = [open(r, "rb") for r in refs]
        try:
            response = client.images.edit(
                model="gpt-image-2",
                image=open_files if len(open_files) > 1 else open_files[0],
                prompt=prompt,
                size=resolution,
                quality="high",
                output_format="jpeg",
                n=1,
            )
        finally:
            for f in open_files:
                f.close()
    else:
        response = client.images.generate(
            model="gpt-image-2",
            prompt=prompt,
            size=resolution,
            quality="high",
            output_format="jpeg",
            n=1,
        )
    image_bytes = base64.b64decode(response.data[0].b64_json)
    output_path.write_bytes(image_bytes)


def generate_gemini(prompt: str, resolution: str, output_path: Path, refs: list[Path]) -> None:
    from google import genai
    from google.genai import types

    aspect_map = {
        "1024x1024": "1:1",
        "1024x576": "16:9",
        "576x1024": "9:16",
    }
    aspect = aspect_map.get(resolution, "1:1")

    client = genai.Client()

    if refs:
        # Multimodal path — pass the reference images as inline Parts alongside the prompt.
        parts: list = []
        for r in refs:
            parts.append(types.Part.from_bytes(
                data=r.read_bytes(),
                mime_type="image/jpeg" if r.suffix.lower() in (".jpg", ".jpeg") else "image/png",
            ))
        parts.append(prompt)
        response = client.models.generate_content(
            model="gemini-3.1-flash-image-preview",
            contents=parts,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
            ),
        )
        # Find the first inline image part in the response
        for part in response.candidates[0].content.parts:
            if getattr(part, "inline_data", None) and part.inline_data.data:
                output_path.write_bytes(part.inline_data.data)
                return
        raise RuntimeError("Gemini returned no image in multimodal response")
    else:
        response = client.models.generate_images(
            model="gemini-3.1-flash-image-preview",
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
                output_mime_type="image/jpeg",
                aspect_ratio=aspect,
            ),
        )
        image_bytes = response.generated_images[0].image.image_bytes
        output_path.write_bytes(image_bytes)


def generate_grok(prompt: str, resolution: str, output_path: Path, refs: list[Path]) -> None:
    import requests

    if refs:
        raise RuntimeError(
            "Grok Imagine Image does not currently support reference images. "
            "Switch IMAGE_MODEL to openai or gemini for this session, or skip the reference."
        )

    api_key = os.environ["XAI_API_KEY"]
    response = requests.post(
        "https://api.x.ai/v1/images/generations",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": "grok-imagine-image",
            "prompt": prompt,
            "n": 1,
            "size": resolution,
            "response_format": "b64_json",
        },
    )
    response.raise_for_status()
    image_bytes = base64.b64decode(response.json()["data"][0]["b64_json"])
    output_path.write_bytes(image_bytes)


GENERATORS = {
    "openai": generate_openai,
    "gemini": generate_gemini,
    "grok": generate_grok,
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a keyframe image")
    parser.add_argument("--model", required=True, choices=list(GENERATORS))
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--resolution", default="1024x1024")
    parser.add_argument(
        "--reference-image",
        action="append",
        default=[],
        help="Path to a reference image. May be passed multiple times.",
    )
    args = parser.parse_args()

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    refs = [Path(p) for p in args.reference_image]
    for r in refs:
        if not r.exists():
            print(f"ERROR: reference image not found: {r}", file=sys.stderr)
            sys.exit(1)

    generate_fn = GENERATORS[args.model]
    try:
        generate_fn(args.prompt, args.resolution, output_path, refs)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"Saved: {output_path}")


if __name__ == "__main__":
    main()
