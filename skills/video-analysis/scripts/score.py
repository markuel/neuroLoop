#!/usr/bin/env python3
"""Score a generated video against a target brain state using TRIBE v2 + BrainAtlas."""

import argparse
import json
import math
import sys
from pathlib import Path


def load_target(target_path: str) -> dict[str, float]:
    data = json.loads(Path(target_path).read_text())
    return data.get("regions", data)


def run_tribe(video_path: str):
    """Run TRIBE v2 on a video. Returns (preds np.ndarray, segments list)."""
    import torch
    from neuralset.models import TribeModel

    model_dir = Path(__file__).resolve().parents[4] / "cache" / "facebook" / "tribev2"
    model = TribeModel.from_pretrained(str(model_dir))
    model.eval()

    events = model.get_events_dataframe(video_path=video_path)

    use_amp = torch.cuda.is_available() and model._model is not None
    if use_amp:
        _orig = model._model.forward
        def _amp_fwd(*a, **kw):
            with torch.autocast("cuda", dtype=torch.float16):
                return _orig(*a, **kw)
        model._model.forward = _amp_fwd

    preds, segments = model.predict(events=events, verbose=False)

    if use_amp:
        model._model.forward = _orig

    return preds, segments


def score_video(video_path: str, target: dict[str, float], segment_duration: int) -> dict:
    import numpy as np
    from neuroLoop.atlas import BrainAtlas

    preds, segments = run_tribe(video_path)

    atlas = BrainAtlas()
    region_df = atlas.all_region_timeseries(preds)

    # Normalize region means to 0–1
    region_means_raw = region_df.mean().to_dict()
    max_val = max(region_means_raw.values()) if region_means_raw else 1.0
    region_means = {r: float(v) / max_val for r, v in region_means_raw.items()}

    # Per-segment scores using segment timestamp alignment
    segment_scores = []
    fps = preds.shape[0] / max(
        (segments[-1].start + segments[-1].duration) if segments else segment_duration, 1
    )

    for seg_idx, seg in enumerate(segments):
        t_start = int(seg.start * fps)
        t_end = int((seg.start + seg.duration) * fps)
        t_end = min(t_end, preds.shape[0])

        if t_start >= t_end:
            segment_scores.append({"index": seg_idx, "score": 0.0})
            continue

        seg_preds = preds[t_start:t_end]
        seg_df = atlas.all_region_timeseries(seg_preds)
        seg_means_raw = seg_df.mean().to_dict()
        seg_max = max(seg_means_raw.values()) if seg_means_raw else 1.0
        seg_means = {r: float(v) / seg_max for r, v in seg_means_raw.items()}

        # Cosine similarity to target over the targeted regions only
        target_regions = set(target.keys())
        dot = sum(seg_means.get(r, 0.0) * target[r] for r in target_regions)
        norm_pred = math.sqrt(sum(seg_means.get(r, 0.0) ** 2 for r in target_regions))
        norm_tgt = math.sqrt(sum(v ** 2 for v in target.values()))
        score = dot / (norm_pred * norm_tgt + 1e-9)
        segment_scores.append({"index": seg_idx, "score": round(score, 4)})

    # Fall back to duration-based splitting if no segment timestamps
    if not segment_scores:
        n_segs = math.ceil(preds.shape[0] / max(int(segment_duration * fps), 1))
        for i in range(n_segs):
            t0 = int(i * segment_duration * fps)
            t1 = min(int((i + 1) * segment_duration * fps), preds.shape[0])
            seg_preds = preds[t0:t1]
            seg_df = atlas.all_region_timeseries(seg_preds)
            seg_means_raw = seg_df.mean().to_dict()
            seg_max = max(seg_means_raw.values()) if seg_means_raw else 1.0
            seg_means = {r: float(v) / seg_max for r, v in seg_means_raw.items()}
            target_regions = set(target.keys())
            dot = sum(seg_means.get(r, 0.0) * target[r] for r in target_regions)
            norm_pred = math.sqrt(sum(seg_means.get(r, 0.0) ** 2 for r in target_regions))
            norm_tgt = math.sqrt(sum(v ** 2 for v in target.values()))
            score = dot / (norm_pred * norm_tgt + 1e-9)
            segment_scores.append({"index": i, "score": round(score, 4)})

    sorted_segs = sorted(segment_scores, key=lambda x: x["score"])
    worst = [s["index"] for s in sorted_segs[:2]]
    overall = sum(s["score"] for s in segment_scores) / len(segment_scores) if segment_scores else 0.0

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

    try:
        result = score_video(args.video, target, args.segment_duration)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2))

    print(f"Overall score: {result['overall_score']:.4f}")
    print(f"Worst segments: {result['worst_segments']}")
    print(f"Saved: {output_path}")


if __name__ == "__main__":
    main()
