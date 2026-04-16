#!/usr/bin/env python3
"""One-time script: extract fsaverage5 mesh + HCP atlas labels and save as .npz files.

Run once, commit the outputs, and the app will load them directly — no nilearn,
nibabel, MNE sample data download, or network access needed at runtime.

Usage:
    python scripts/bundle_mesh.py

Outputs:
    dashboard/backend/data/fsaverage5_mesh.npz   (~400 KB)
    dashboard/backend/data/hcp_atlas.npz         (~50 KB)
"""

import numpy as np
import nibabel as nib
from nilearn.datasets import fetch_surf_fsaverage
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "dashboard" / "backend" / "data"
MESH_PATH = DATA_DIR / "fsaverage5_mesh.npz"
ATLAS_PATH = DATA_DIR / "hcp_atlas.npz"


def bundle_mesh():
    print("Fetching fsaverage5 mesh from nilearn...")
    fs = fetch_surf_fsaverage("fsaverage5")

    vertices_list = []
    faces_list = []
    offset = 0
    for hemi in ("left", "right"):
        coords, faces_arr = nib.load(fs[f"pial_{hemi}"]).darrays
        coords = coords.data
        faces_arr = faces_arr.data
        vertices_list.append(coords)
        faces_list.append(faces_arr + offset)
        offset += len(coords)

    vertices = np.concatenate(vertices_list, axis=0).astype(np.float32)
    faces = np.concatenate(faces_list, axis=0).astype(np.uint32)

    MESH_PATH.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(MESH_PATH, vertices=vertices, faces=faces)

    size_kb = MESH_PATH.stat().st_size / 1024
    print(f"  Saved {MESH_PATH} ({size_kb:.0f} KB)")
    print(f"  vertices: {vertices.shape}  faces: {faces.shape}")


def bundle_atlas():
    """Extract HCP-MMP1 atlas labels (region -> vertex indices) for hemi='both'.

    This is what triggers the 1.65GB MNE sample data download at runtime.
    We do it once here and save the result so it never needs to happen again.
    """
    from tribev2.utils import get_hcp_labels

    print("Extracting HCP-MMP1 atlas labels (this downloads MNE data once)...")
    labels = get_hcp_labels(mesh="fsaverage5", combine=False, hemi="both")

    # Save as npz: each region name -> vertex index array
    ATLAS_PATH.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(ATLAS_PATH, **{name: idxs for name, idxs in labels.items()})

    size_kb = ATLAS_PATH.stat().st_size / 1024
    print(f"  Saved {ATLAS_PATH} ({size_kb:.0f} KB)")
    print(f"  {len(labels)} regions")


def main():
    bundle_mesh()
    bundle_atlas()
    print()
    print("Done. Commit both files in dashboard/backend/data/ —")
    print("the app will load them directly, no network or MNE sample data needed.")


if __name__ == "__main__":
    main()
