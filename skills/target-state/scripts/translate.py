#!/usr/bin/env python3
"""Translate a natural language brain state description into a target region activation map."""

import argparse
import json
import sys
from pathlib import Path


REGION_MAP: dict[str, dict[str, float]] = {
    "visual": {"V1": 0.7, "V2": 0.6, "V3": 0.6, "V4": 0.5},
    "attention": {"V1": 0.5, "V2": 0.5, "V3A": 0.6, "IPS": 0.7},
    "motion": {"MT": 0.9, "MST": 0.8, "V6": 0.7, "V3A": 0.6},
    "speed": {"MT": 0.9, "MST": 0.9, "V6": 0.8},
    "optical flow": {"MT": 1.0, "MST": 0.9, "V6": 0.7},
    "face": {"FFC": 0.9, "STV": 0.8, "FFA": 0.9},
    "people": {"FFC": 0.7, "STV": 0.8, "FFA": 0.7},
    "social": {"FFC": 0.6, "STV": 0.7, "mPFC": 0.6, "PCC": 0.5},
    "navigation": {"RSC": 0.9, "PHA1": 0.9, "PHA2": 0.8, "PHA3": 0.7},
    "spatial": {"RSC": 0.8, "PHA1": 0.7, "IPS": 0.6},
    "place": {"RSC": 0.9, "PHA1": 0.9, "PHA2": 0.8},
    "scene": {"RSC": 0.8, "PHA1": 0.8, "PHA2": 0.7, "PHA3": 0.6},
    "memory": {"PCC": 0.7, "mPFC": 0.6, "hippocampus": 0.8},
    "default mode": {"PCC": 0.8, "mPFC": 0.8, "angular gyrus": 0.7},
    "language": {"STSva": 0.8, "STSda": 0.7, "TE1a": 0.6},
    "emotion": {"amygdala": 0.8, "insula": 0.7, "ACC": 0.5},
    "arousal": {"amygdala": 0.7, "insula": 0.8},
    "executive": {"dlPFC": 0.8, "ACC": 0.7, "IPS": 0.6},
    "control": {"dlPFC": 0.7, "ACC": 0.6},
    "body": {"somatomotor": 0.8, "premotor": 0.7},
    "movement": {"somatomotor": 0.7, "premotor": 0.8, "MT": 0.5},
    "tool": {"somatomotor": 0.6, "premotor": 0.7},
    "texture": {"V1": 0.8, "V2": 0.7, "V4": 0.6},
    "color": {"V4": 0.8, "V1": 0.5, "V2": 0.5},
    "calm": {"PCC": 0.4, "mPFC": 0.4},
    "meditative": {"PCC": 0.5, "mPFC": 0.5, "insula": 0.3},
    "awe": {"PCC": 0.6, "mPFC": 0.5, "amygdala": 0.5, "RSC": 0.4},
    "wonder": {"PCC": 0.5, "mPFC": 0.5, "RSC": 0.5},
}

NETWORK_LABELS: dict[str, list[str]] = {
    "early_visual": ["V1", "V2", "V3", "V4"],
    "motion": ["MT", "MST", "V6", "V3A"],
    "face_body": ["FFC", "STV", "FFA"],
    "scene_navigation": ["RSC", "PHA1", "PHA2", "PHA3"],
    "default_mode": ["PCC", "mPFC", "angular gyrus", "hippocampus"],
    "language": ["STSva", "STSda", "TE1a"],
    "limbic": ["amygdala", "insula", "ACC"],
    "frontoparietal": ["dlPFC", "IPS"],
    "somatomotor": ["somatomotor", "premotor"],
}


def description_to_regions(description: str) -> dict[str, float]:
    desc_lower = description.lower()
    merged: dict[str, list[float]] = {}

    for keyword, regions in REGION_MAP.items():
        if keyword in desc_lower:
            for region, strength in regions.items():
                merged.setdefault(region, []).append(strength)

    if not merged:
        # Fallback: use LLM to parse if available, otherwise broad visual default
        try:
            import anthropic
            client = anthropic.Anthropic()
            msg = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=512,
                messages=[{
                    "role": "user",
                    "content": (
                        f"Map this brain state description to HCP-MMP1 regions with activation levels 0-1.\n"
                        f"Description: {description}\n"
                        f"Return only JSON: {{\"region_name\": activation_level, ...}}\n"
                        f"Include 3-10 most relevant regions."
                    ),
                }],
            )
            merged_raw = json.loads(msg.content[0].text)
            return {k: round(float(v), 2) for k, v in merged_raw.items()}
        except Exception:
            return {"V1": 0.5, "V2": 0.5, "MT": 0.5}

    return {region: round(max(vals), 2) for region, vals in merged.items()}


def infer_networks(regions: dict[str, float]) -> list[str]:
    active = set(regions.keys())
    networks = []
    for net, members in NETWORK_LABELS.items():
        if any(r in active for r in members):
            networks.append(net)
    return networks


def main() -> None:
    parser = argparse.ArgumentParser(description="Translate brain state description to region map")
    parser.add_argument("--description", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    regions = description_to_regions(args.description)
    if not regions:
        print("Could not map description to any brain regions", file=sys.stderr)
        sys.exit(1)

    networks = infer_networks(regions)

    result = {
        "description": args.description,
        "regions": regions,
        "primary_networks": networks,
        "notes": f"Mapped {len(regions)} regions across {len(networks)} networks.",
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2))

    print(f"Mapped {len(regions)} regions: {', '.join(regions.keys())}")
    print(f"Saved: {output_path}")


if __name__ == "__main__":
    main()
