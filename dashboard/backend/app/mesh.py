# dashboard/backend/app/mesh.py
import numpy as np
from functools import lru_cache
from pathlib import Path

# Bundled mesh file — generated once by scripts/bundle_mesh.py, committed to repo
_MESH_PATH = Path(__file__).resolve().parent.parent / "data" / "fsaverage5_mesh.npz"


@lru_cache
def get_fsaverage5_mesh() -> tuple[np.ndarray, np.ndarray]:
    """Load fsaverage5 mesh geometry as numpy arrays. Cached after first call.

    Returns (vertices, faces) where vertices is (N, 3) float32
    and faces is (F, 3) uint32.
    """
    if not _MESH_PATH.exists():
        raise FileNotFoundError(
            f"Bundled mesh not found at {_MESH_PATH}. "
            f"Run: python scripts/bundle_mesh.py"
        )
    data = np.load(_MESH_PATH)
    return data["vertices"], data["faces"]


@lru_cache
def get_fsaverage5_mesh_binary() -> tuple[bytes, int, int]:
    """Return mesh as packed binary (vertices bytes + faces bytes) with counts."""
    vertices, faces = get_fsaverage5_mesh()
    buf = vertices.tobytes() + faces.tobytes()
    return buf, len(vertices), len(faces)
