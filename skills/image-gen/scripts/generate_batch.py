#!/usr/bin/env python3
"""Generate all keyframe images from keyframes.json in parallel."""

import argparse
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


def load_keyframes(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    keyframes = data.get("keyframes")
    if not isinstance(keyframes, list) or not keyframes:
        raise ValueError("keyframes.json must contain a non-empty 'keyframes' array")

    normalized = []
    for item in keyframes:
        if not isinstance(item, dict):
            raise ValueError("Each keyframe must be an object")
        index = item.get("index")
        prompt = item.get("prompt")
        if not isinstance(index, int):
            raise ValueError(f"Keyframe has invalid index: {index!r}")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError(f"Keyframe {index} is missing a prompt")
        normalized.append({"index": index, "prompt": prompt.strip()})
    return sorted(normalized, key=lambda k: k["index"])


def generate_one(
    script_path: Path,
    model: str,
    resolution: str,
    output_dir: Path,
    references: list[Path],
    keyframe: dict,
    skip_existing: bool,
) -> tuple[int, Path, subprocess.CompletedProcess | None]:
    index = keyframe["index"]
    output = output_dir / f"frame_{index:02d}.jpg"
    if skip_existing and output.exists():
        return index, output, None

    cmd = [
        sys.executable,
        str(script_path),
        "--model",
        model,
        "--prompt",
        keyframe["prompt"],
        "--output",
        str(output),
        "--resolution",
        resolution,
    ]
    for ref in references:
        cmd.extend(["--reference-image", str(ref)])

    result = subprocess.run(cmd, text=True, capture_output=True)
    return index, output, result


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate keyframe images from keyframes.json in parallel")
    parser.add_argument("--model", required=True, choices=["openai", "gemini", "grok"])
    parser.add_argument("--keyframes-json", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--resolution", default="1024x1024")
    parser.add_argument(
        "--max-workers",
        type=int,
        default=int(os.environ.get("IMAGE_GEN_MAX_WORKERS", "4")),
        help="Maximum concurrent image generations. Defaults to IMAGE_GEN_MAX_WORKERS or 4.",
    )
    parser.add_argument(
        "--reference-image",
        action="append",
        default=[],
        type=Path,
        help="Reference image applied to every generated keyframe. May be passed multiple times.",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Leave existing frame_XX.jpg files untouched.",
    )
    args = parser.parse_args()

    try:
        keyframes = load_keyframes(args.keyframes_json)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    for ref in args.reference_image:
        if not ref.exists():
            print(f"ERROR: reference image not found: {ref}", file=sys.stderr)
            sys.exit(1)

    script_path = Path(__file__).with_name("generate.py")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    max_workers = max(1, min(args.max_workers, len(keyframes)))

    print(f"Generating {len(keyframes)} keyframes with {max_workers} worker(s)")

    failures = []
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [
            pool.submit(
                generate_one,
                script_path,
                args.model,
                args.resolution,
                args.output_dir,
                args.reference_image,
                keyframe,
                args.skip_existing,
            )
            for keyframe in keyframes
        ]

        for future in as_completed(futures):
            index, output, result = future.result()
            if result is None:
                print(f"Skipped existing: {output}")
                continue
            if result.returncode == 0:
                print(f"Saved frame {index}: {output}")
            else:
                failures.append((index, result))
                stderr = result.stderr.strip() or result.stdout.strip() or "unknown error"
                print(f"ERROR frame {index}: {stderr}", file=sys.stderr)

    if failures:
        print(f"Failed to generate {len(failures)} keyframe(s)", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
