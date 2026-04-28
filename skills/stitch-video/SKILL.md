---
name: stitch-video
description: Concatenates a list of video segments into a single final.mp4 using ffmpeg. Use this skill whenever you need to stitch multiple segment files into one video as part of the neuroLoop agent loop.
---

# Stitch Video Skill

Concatenates all segment MP4 files for an iteration into a single `final.mp4`. Uses ffmpeg stream copy (no re-encode) for speed.

## Running the script

```bash
python skills/stitch-video/scripts/stitch.py \
  --segments agent/sessions/{SESSION_ID}/iterations/{N}/segments/seg_00.mp4 \
             agent/sessions/{SESSION_ID}/iterations/{N}/segments/seg_01.mp4 \
             agent/sessions/{SESSION_ID}/iterations/{N}/segments/seg_02.mp4 \
  --output agent/sessions/{SESSION_ID}/iterations/{N}/final.mp4
```

Or use a glob pattern to pick them all up in order:

```bash
python skills/stitch-video/scripts/stitch.py \
  --segments-dir agent/sessions/{SESSION_ID}/iterations/{N}/segments/ \
  --output agent/sessions/{SESSION_ID}/iterations/{N}/final.mp4
```

When using `--segments-dir`, files are sorted numerically by the number in their filename (seg_00, seg_01, …).

## Output

A single MP4 at the specified output path. If a `final.mp4` already exists at that path it will be overwritten.

## Notes

- All input segments must have the same codec, resolution, and frame rate for stream copy to work. If they don't (e.g., different models produced segments for the same iteration), use `--reencode` to force a full re-encode.
- For surgical edits, you can mix segments from different iterations — just list each file explicitly in the correct order.
