# dashboard/backend/app/mesh.py
import numpy as np
import nibabel as nib
from functools import lru_cache
from nilearn.datasets import fetch_surf_fsaverage


@lru_cache
def get_fsaverage5_mesh() -> tuple[np.ndarray, np.ndarray]:
    """Load fsaverage5 mesh geometry as numpy arrays. Cached after first call.

    Returns (vertices, faces) where vertices is (N, 3) float32
    and faces is (F, 3) uint32.
    """
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
    return vertices, faces


@lru_cache
def get_fsaverage5_mesh_binary() -> tuple[bytes, int, int]:
    """Return mesh as packed binary (vertices bytes + faces bytes) with counts."""
    vertices, faces = get_fsaverage5_mesh()
    buf = vertices.tobytes() + faces.tobytes()
    return buf, len(vertices), len(faces)
