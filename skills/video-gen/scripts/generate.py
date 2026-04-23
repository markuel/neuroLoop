#!/usr/bin/env python3
"""Generate a single video segment from start/end keyframes and a motion prompt."""

import argparse
import base64
import os
import sys
import time
import urllib.request
from pathlib import Path


def encode_image(path: str) -> str:
    return base64.b64encode(Path(path).read_bytes()).decode()


def image_to_data_uri(path: str) -> str:
    return f"data:image/jpeg;base64,{encode_image(path)}"


def generate_veo(start: str, end: str, prompt: str, duration: int, output: Path) -> None:
    from google import genai
    from google.genai import types

    client = genai.Client()

    def load_image(path: str) -> types.Image:
        return types.Image(image_bytes=Path(path).read_bytes(), mime_type="image/jpeg")

    operation = client.models.generate_videos(
        model="veo-3.0-generate-preview",
        prompt=prompt,
        image=load_image(start),
        config=types.GenerateVideosConfig(
            duration_seconds=min(duration, 8),
            aspect_ratio="16:9",
            number_of_videos=1,
        ),
    )

    while not operation.done:
        time.sleep(20)
        operation = client.operations.get(operation)

    video_bytes = operation.result.generated_videos[0].video.video_bytes
    output.write_bytes(video_bytes)


def generate_seeddance(start: str, end: str, prompt: str, duration: int, output: Path) -> None:
    import replicate

    result = replicate.run(
        "bytedance/seedance-2.0",
        input={
            "prompt": prompt,
            "image": image_to_data_uri(start),
            "last_image": image_to_data_uri(end),
            "duration": 5 if duration <= 5 else 10,
            "resolution": "1080p",
            "aspect_ratio": "16:9",
        },
    )
    video_url = result if isinstance(result, str) else result[0]
    urllib.request.urlretrieve(video_url, str(output))


def generate_grok_video(start: str, end: str, prompt: str, duration: int, output: Path) -> None:
    import requests

    api_key = os.environ["XAI_API_KEY"]
    base_url = "https://api.x.ai/v1"

    resp = requests.post(
        f"{base_url}/videos/generations",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": "grok-imagine-video",
            "prompt": prompt,
            "first_frame_image": image_to_data_uri(start),
            "last_frame_image": image_to_data_uri(end),
            "duration": min(duration, 10),
            "resolution": "720p",
            "aspect_ratio": "16:9",
            "n": 1,
        },
    )
    resp.raise_for_status()
    job_id = resp.json()["id"]

    while True:
        status = requests.get(
            f"{base_url}/videos/generations/{job_id}",
            headers={"Authorization": f"Bearer {api_key}"},
        ).json()
        if status["status"] == "completed":
            break
        elif status["status"] == "failed":
            raise RuntimeError(f"Job failed: {status}")
        time.sleep(15)

    video_bytes = requests.get(status["videos"][0]["url"]).content
    output.write_bytes(video_bytes)


GENERATORS = {
    "veo": generate_veo,
    "seeddance": generate_seeddance,
    "grok-video": generate_grok_video,
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a video segment")
    parser.add_argument("--model", required=True, choices=list(GENERATORS))
    parser.add_argument("--start-frame", required=True)
    parser.add_argument("--end-frame", required=True)
    parser.add_argument("--motion-prompt", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--duration", type=int, default=8)
    args = parser.parse_args()

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    try:
        GENERATORS[args.model](args.start_frame, args.end_frame, args.motion_prompt, args.duration, output)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"Saved: {output}")


if __name__ == "__main__":
    main()
