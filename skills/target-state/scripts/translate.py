#!/usr/bin/env python3
"""Translate a natural language brain state description into a target region activation map.

Uses FINE_GROUPS and COARSE_GROUPS from neuroLoop.regions for all valid region names,
then maps the description to relevant regions via keyword lookup + optional LLM fallback.
"""

import argparse
import json
import sys
from pathlib import Path

# All valid region names come from the installed neuroLoop package
from neuroLoop.regions import COARSE_GROUPS, FINE_GROUPS

# Flat set of all 180 valid region names
ALL_REGIONS: set[str] = {r for regions in FINE_GROUPS.values() for r in regions}

# Reverse lookup: region → fine network name
REGION_TO_FINE: dict[str, str] = {
    r: net for net, regions in FINE_GROUPS.items() for r in regions
}

# Reverse lookup: region → coarse network name
REGION_TO_COARSE: dict[str, str] = {
    r: net for net, regions in COARSE_GROUPS.items() for r in regions
}

# ── Keyword → (regions, base_strength) mapping ────────────────────────────
# Keywords map to specific regions by neuroscientific evidence.
# Strength 1.0 = primary target, 0.7 = secondary, 0.5 = incidental.
KEYWORD_MAP: list[tuple[list[str], list[str], float]] = [
    # Visual — primary
    (["visual", "see", "sight", "look"], ["V1", "V2", "V3", "V4"], 0.7),
    # Motion
    (["motion", "movement", "flow", "moving", "speed", "fast", "dynamic"], ["MT", "MST", "V6", "V3A", "V6A"], 1.0),
    (["optical flow", "rushing", "whooshing"], ["MT", "MST", "V6"], 1.0),
    # Color / texture
    (["color", "colour", "vivid", "vibrant", "saturated"], ["V4", "V8", "VVC"], 0.8),
    (["texture", "detail", "sharp", "crisp"], ["V1", "V2", "V3"], 0.8),
    # Scene / navigation
    (["navigation", "navigate", "explore", "moving through", "fly through"], ["RSC", "PHA1", "PHA2", "PHA3", "ProS"], 1.0),
    (["place", "location", "environment", "scene", "landscape", "room", "space"], ["PHA1", "PHA2", "PHA3", "RSC"], 0.9),
    (["architecture", "building", "indoor", "outdoor", "street", "forest", "nature"], ["PHA1", "PHA2", "RSC", "V3A"], 0.8),
    # Faces / social
    (["face", "faces", "person", "people", "social", "human"], ["FFC", "STV", "STSva", "STSda"], 0.9),
    (["emotion", "emotional", "feeling"], ["FFC", "STV", "a24", "p24"], 0.8),
    (["eye contact", "gaze", "stare"], ["FFC", "STV", "FEF"], 0.9),
    # Biological motion / body
    (["body", "gesture", "dance", "walk", "run", "biological motion"], ["STV", "TPOJ1", "TPOJ2", "4", "3b"], 0.9),
    (["hand", "hands", "finger", "touch", "grip", "tool"], ["4", "3a", "3b", "1", "2", "AIP"], 0.8),
    # Default mode / introspection
    (["calm", "peaceful", "meditation", "meditative", "quiet", "still"], ["RSC", "POS1", "POS2", "v23ab"], 0.6),
    (["contemplative", "reflective", "introspective", "mindful"], ["PCV", "d23ab", "31pv", "9m"], 0.7),
    (["awe", "wonder", "transcendent", "vast", "infinite"], ["RSC", "PHA1", "a24", "PCV"], 0.8),
    (["nostalgic", "memory", "familiar", "warm"], ["RSC", "H", "EC", "PCV"], 0.7),
    # Attention / executive
    (["attention", "focus", "alert", "aware"], ["FEF", "IPS1", "LIPd", "LIPv", "VIP"], 0.7),
    (["complex", "multiple", "tracking", "busy"], ["LIPd", "VIP", "AIP", "7PC", "7AL"], 0.7),
    # Auditory association (targetable visually via mouth movement)
    (["speech", "talking", "speaking", "conversation", "voice", "words"], ["STSva", "STSda", "STSvp", "STSdp", "TA2"], 0.8),
    # Reward / pleasant
    (["beautiful", "pleasant", "reward", "satisfying", "appealing"], ["OFC", "pOFC", "11l", "13l"], 0.7),
]


def description_to_regions(description: str) -> dict[str, float]:
    desc_lower = description.lower()
    accumulated: dict[str, list[float]] = {}

    for keywords, regions, strength in KEYWORD_MAP:
        if any(kw in desc_lower for kw in keywords):
            for region in regions:
                if region in ALL_REGIONS:  # only valid HCP-MMP1 regions
                    accumulated.setdefault(region, []).append(strength)

    if accumulated:
        # Take the max strength seen for each region
        return {r: round(max(vals), 2) for r, vals in accumulated.items()}

    # Fallback: LLM call to handle descriptions that don't match keywords
    try:
        import anthropic
        client = anthropic.Anthropic()
        valid_sample = sorted(ALL_REGIONS)[:40]  # give the model examples
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            messages=[{
                "role": "user",
                "content": (
                    f"Map this brain state description to HCP-MMP1 cortical region names.\n"
                    f"Description: {description}\n\n"
                    f"Valid region names include: {', '.join(valid_sample)}, and ~140 more.\n"
                    f"Return ONLY a JSON object: {{\"REGION_NAME\": activation_0_to_1, ...}}\n"
                    f"Include 5–15 of the most relevant regions. Use exact region names."
                ),
            }],
        )
        raw = json.loads(msg.content[0].text)
        # Filter to only valid region names
        return {k: round(float(v), 2) for k, v in raw.items() if k in ALL_REGIONS}
    except Exception:
        # Last resort: broad visual default
        return {"V1": 0.5, "V2": 0.5, "MT": 0.5, "PHA1": 0.4}


def infer_networks(regions: dict[str, float]) -> list[str]:
    coarse_seen = set()
    for r in regions:
        if r in REGION_TO_COARSE:
            coarse_seen.add(REGION_TO_COARSE[r])
    return sorted(coarse_seen)


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
    fine_networks = sorted({REGION_TO_FINE[r] for r in regions if r in REGION_TO_FINE})

    result = {
        "description": args.description,
        "regions": regions,
        "primary_networks": networks,
        "fine_networks": fine_networks,
        "notes": f"Mapped {len(regions)} regions across {len(networks)} coarse networks ({', '.join(networks)}).",
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2))

    print(f"Mapped {len(regions)} regions: {', '.join(sorted(regions.keys()))}")
    print(f"Networks: {', '.join(networks)}")
    print(f"Saved: {output_path}")


if __name__ == "__main__":
    main()
