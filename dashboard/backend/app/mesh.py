# dashboard/backend/app/mesh.py
import numpy as np
import nibabel as nib
from functools import lru_cache
from nilearn.datasets import fetch_surf_fsaverage

@lru_cache
def get_fsaverage5_mesh() -> dict:
    """Load fsaverage5 mesh geometry. Cached after first call."""
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

    vertices = np.concatenate(vertices_list, axis=0)
    faces = np.concatenate(faces_list, axis=0)
    return {
        "vertices": vertices.tolist(),
        "faces": faces.tolist(),
        "n_vertices": len(vertices),
    }
