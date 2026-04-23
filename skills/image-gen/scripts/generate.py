#!/usr/bin/env python3
"""Generate a single keyframe image using the specified model."""

import argparse
import base64
import os
import sys
from pathlib import Path


def generate_openai(prompt: str, resolution: str, output_path: Path) -> None:
    from openai import OpenAI

    client = OpenAI()
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


def generate_gemini(prompt: str, resolution: str, output_path: Path) -> None:
    from google import genai
    from google.genai import types

    aspect_map = {
        "1024x1024": "1:1",
        "1024x576": "16:9",
        "576x1024": "9:16",
    }
    aspect = aspect_map.get(resolution, "1:1")

    client = genai.Client()
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


def generate_grok(prompt: str, resolution: str, output_path: Path) -> None:
    import requests

    api_key = os.environ["XAI_API_KEY"]
    response = requests.post(
        "https://api.x.ai/v1/images/generations",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": "grok-2-image",
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
    args = parser.parse_args()

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    generate_fn = GENERATORS[args.model]
    try:
        generate_fn(args.prompt, args.resolution, output_path)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"Saved: {output_path}")


if __name__ == "__main__":
    main()
