#!/usr/bin/env python3
"""Score a generated video against a target brain state using TRIBE v2."""

import argparse
import json
import math
import sys
from pathlib import Path


def load_target(target_path: str) -> dict[str, float]:
    data = json.loads(Path(target_path).read_text())
    return data.get("regions", data)


def run_tribe(video_path: str) -> dict:
    """Run TRIBE v2 and return raw predictions keyed by region and time."""
    try:
        import torch
        from neuroloop.tribe import TribeModel, preprocess_video

        model = TribeModel.from_pretrained("cache/facebook/tribev2")
        model.eval()

        frames = preprocess_video(video_path)
        with torch.no_grad():
            predictions = model(frames)

        return predictions
    except ImportError as exc:
        print(f"TRIBE v2 not available: {exc}", file=sys.stderr)
        sys.exit(1)


def normalize(activations: dict[str, float]) -> dict[str, float]:
    if not activations:
        return activations
    max_val = max(activations.values()) or 1.0
    return {k: v / max_val for k, v in activations.items()}


def score_video(video_path: str, target: dict[str, float], segment_duration: int) -> dict:
    predictions = run_tribe(video_path)

    # predictions shape: {region: [t0, t1, t2, ...]} (one value per second or per frame)
    region_means = {}
    for region, timeseries in predictions.items():
        region_means[region] = sum(timeseries) / len(timeseries) if timeseries else 0.0

    region_means = normalize(region_means)

    # Compute per-segment scores
    fps = 1  # TRIBE v2 returns 1 prediction per second
    segment_scores = []
    total_seconds = max(len(v) for v in predictions.values()) if predictions else 0

    for seg_idx in range(math.ceil(total_seconds / segment_duration)):
        t_start = seg_idx * segment_duration
        t_end = min(t_start + segment_duration, total_seconds)

        seg_means = {}
        for region, timeseries in predictions.items():
            window = timeseries[t_start:t_end]
            seg_means[region] = sum(window) / len(window) if window else 0.0
        seg_means = normalize(seg_means)

        # Cosine-like similarity to target for this segment
        target_regions = set(target.keys())
        if target_regions:
            score = sum(
                seg_means.get(r, 0.0) * target[r]
                for r in target_regions
            ) / (
                math.sqrt(sum(v ** 2 for v in target.values())) *
                math.sqrt(sum(seg_means.get(r, 0.0) ** 2 for r in target_regions)) + 1e-9
            )
        else:
            score = 0.0
        segment_scores.append({"index": seg_idx, "score": round(score, 4)})

    sorted_segs = sorted(segment_scores, key=lambda x: x["score"])
    worst = [s["index"] for s in sorted_segs[:2]]

    # Overall score = mean of segment scores
    overall = sum(s["score"] for s in segment_scores) / len(segment_scores) if segment_scores else 0.0

    # Region deltas
    region_deltas = {
        r: round(region_means.get(r, 0.0) - target.get(r, 0.0), 4)
        for r in set(list(region_means.keys()) + list(target.keys()))
    }

    return {
        "overall_score": round(overall, 4),
        "segment_scores": segment_scores,
        "worst_segments": worst,
        "mean_activations": {k: round(v, 4) for k, v in region_means.items()},
        "target_activations": target,
        "region_deltas": region_deltas,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Score a video with TRIBE v2")
    parser.add_argument("--video", required=True)
    parser.add_argument("--target", required=True, help="Path to target_state.json")
    parser.add_argument("--output", required=True, help="Path to write score.json")
    parser.add_argument("--segment-duration", type=int, default=8)
    args = parser.parse_args()

    target = load_target(args.target)
    result = score_video(args.video, target, args.segment_duration)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2))

    print(f"Overall score: {result['overall_score']:.4f}")
    print(f"Worst segments: {result['worst_segments']}")
    print(f"Saved: {output_path}")


if __name__ == "__main__":
    main()
