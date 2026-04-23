#!/usr/bin/env python3
"""Concatenate video segments into a single final.mp4 using ffmpeg."""

import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path


def natural_sort_key(path: Path) -> list:
    parts = re.split(r"(\d+)", path.stem)
    return [int(p) if p.isdigit() else p for p in parts]


def stitch(segments: list[Path], output: Path, reencode: bool) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        for seg in segments:
            f.write(f"file '{seg.resolve()}'\n")
        concat_list = f.name

    if reencode:
        cmd = [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", concat_list,
            "-c:v", "libx264", "-preset", "fast", "-crf", "18",
            "-c:a", "aac",
            str(output),
        ]
    else:
        cmd = [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", concat_list,
            "-c", "copy",
            str(output),
        ]

    result = subprocess.run(cmd, capture_output=True)
    Path(concat_list).unlink(missing_ok=True)

    if result.returncode != 0:
        print(result.stderr.decode(), file=sys.stderr)
        sys.exit(1)

    print(f"Stitched {len(segments)} segments → {output}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Stitch video segments")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--segments", nargs="+", type=Path, help="Explicit ordered list of segment files")
    group.add_argument("--segments-dir", type=Path, help="Directory containing seg_NN.mp4 files")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--reencode", action="store_true", help="Force re-encode instead of stream copy")
    args = parser.parse_args()

    if args.segments_dir:
        segments = sorted(args.segments_dir.glob("seg_*.mp4"), key=natural_sort_key)
        if not segments:
            print(f"No seg_*.mp4 files found in {args.segments_dir}", file=sys.stderr)
            sys.exit(1)
    else:
        segments = args.segments

    stitch(segments, args.output, args.reencode)


if __name__ == "__main__":
    main()
