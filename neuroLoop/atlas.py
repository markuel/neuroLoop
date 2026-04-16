"""BrainAtlas — SDK for working with TRIBE v2 predictions using HCP-MMP1 regions."""

from __future__ import annotations

import typing as tp

import numpy as np
import pandas as pd

from .regions import COARSE_GROUPS, FINE_GROUPS


class BrainAtlas:
    """Map TRIBE v2 vertex-level predictions to named HCP-MMP1 brain regions.

    Parameters
    ----------
    mesh : str
        fsaverage mesh resolution. Default ``"fsaverage5"`` (10,242 vertices
        per hemisphere, 20,484 total) — matches TRIBE v2 output.
    hemi : str
        Default hemisphere handling: ``"both"`` combines left + right,
        ``"left"`` or ``"right"`` restricts to one hemisphere.

    Examples
    --------
    >>> from neuroLoop import BrainAtlas
    >>> atlas = BrainAtlas()
    >>> df = atlas.to_dataframe(preds)          # (n_timesteps, 360) DataFrame
    >>> ts = atlas.region_timeseries(preds, "V1")  # 1D array for V1
    >>> grouped = atlas.all_group_timeseries(preds, level="coarse")
    """

    def __init__(
        self,
        mesh: str = "fsaverage5",
        hemi: str = "both",
    ) -> None:
        self.mesh = mesh
        self.hemi = hemi
        self._labels: dict[str, np.ndarray] | None = None
        self._v2r: dict[int, str] | None = None
        self._indicator: np.ndarray | None = None
        self._indicator_names: list[str] | None = None

    @property
    def labels(self) -> dict[str, np.ndarray]:
        """Cached region-name -> vertex-indices mapping."""
        if self._labels is None:
            from tribev2.utils import get_hcp_labels
            self._labels = get_hcp_labels(
                mesh=self.mesh, combine=False, hemi=self.hemi
            )
        return self._labels

    @property
    def vertex_to_region(self) -> dict[int, str]:
        """Cached reverse lookup: vertex index -> region name. Built once."""
        if not hasattr(self, '_v2r') or self._v2r is None:
            self._v2r = {}
            for name, idxs in self.labels.items():
                for i in idxs:
                    self._v2r[int(i)] = name
        return self._v2r

    @property
    def _indicator_matrix(self) -> tuple[np.ndarray, list[str]]:
        """Cached (n_vertices, n_regions) indicator matrix for fast matmul.

        Each column has 1/count at the vertex positions for that region,
        so preds @ indicator = region means.
        """
        if not hasattr(self, '_indicator') or self._indicator is None:
            labels = self.labels
            region_names = list(labels.keys())
            # Infer n_vertices from the max vertex index
            max_idx = max(int(idx.max()) for idx in labels.values() if len(idx) > 0)
            n_verts = max_idx + 1
            indicator = np.zeros((n_verts, len(region_names)), dtype=np.float32)
            for i, (name, idxs) in enumerate(labels.items()):
                if len(idxs) > 0:
                    indicator[idxs, i] = 1.0 / len(idxs)
            self._indicator = indicator
            self._indicator_names = region_names
        return self._indicator, self._indicator_names

    # ------------------------------------------------------------------
    # Region queries
    # ------------------------------------------------------------------

    def list_regions(self, group: str | None = None, level: str = "coarse") -> list[str]:
        """List available region names.

        Parameters
        ----------
        group : str, optional
            If provided, only return regions belonging to this functional
            network group. Must match a key in the grouping table for the
            given *level*.
        level : str
            ``"coarse"`` (~7 networks) or ``"fine"`` (~22 networks).
            Only used when *group* is provided.

        Returns
        -------
        list[str]
        """
        if group is None:
            return list(self.labels.keys())
        groups = _get_groups(level)
        if group not in groups:
            available = ", ".join(sorted(groups.keys()))
            raise ValueError(
                f"Unknown group {group!r} at level={level!r}. "
                f"Available: {available}"
            )
        return list(groups[group])

    def list_groups(self, level: str = "coarse") -> list[str]:
        """List available functional network group names.

        Parameters
        ----------
        level : str
            ``"coarse"`` (~7 networks) or ``"fine"`` (~22 networks).
        """
        return list(_get_groups(level).keys())

    def get_vertices(self, region: str) -> np.ndarray:
        """Return vertex indices for a region. Supports ``*`` wildcards.

        Parameters
        ----------
        region : str
            Exact region name (e.g. ``"V1"``) or wildcard pattern
            (e.g. ``"V*"`` for all visual areas starting with V).
        """
        # Fast path: exact match from cached labels (avoids re-reading annotations)
        if '*' not in region and '?' not in region:
            labels = self.labels
            if region in labels:
                return labels[region]
        from tribev2.utils import get_hcp_roi_indices
        return get_hcp_roi_indices(region, hemi=self.hemi, mesh=self.mesh)

    def region_for_vertex(self, vertex_idx: int) -> str | None:
        """Return the region name that owns a given vertex index, or None."""
        return self.vertex_to_region.get(vertex_idx)

    # ------------------------------------------------------------------
    # Time-series extraction
    # ------------------------------------------------------------------

    def region_timeseries(
        self, preds: np.ndarray, region: str
    ) -> np.ndarray:
        """Mean activation in one region across all timesteps.

        Parameters
        ----------
        preds : np.ndarray
            Shape ``(n_timesteps, n_vertices)`` from ``model.predict()``.
        region : str
            Region name or wildcard pattern.

        Returns
        -------
        np.ndarray
            Shape ``(n_timesteps,)``.
        """
        preds = _validate_preds(preds)
        idx = self.get_vertices(region)
        return preds[:, idx].mean(axis=1)

    def all_region_timeseries(self, preds: np.ndarray) -> pd.DataFrame:
        """Mean activation per region across all timesteps.

        Parameters
        ----------
        preds : np.ndarray
            Shape ``(n_timesteps, n_vertices)``.

        Returns
        -------
        pd.DataFrame
            Rows = timesteps, columns = region names.
        """
        preds = _validate_preds(preds)
        indicator, region_names = self._indicator_matrix
        # Single matmul: (n_timesteps, n_vertices) @ (n_vertices, n_regions)
        data = preds @ indicator
        return pd.DataFrame(data, columns=region_names)

    def group_timeseries(
        self, preds: np.ndarray, group: str, level: str = "coarse"
    ) -> np.ndarray:
        """Mean activation across all regions in a functional network group.

        Parameters
        ----------
        preds : np.ndarray
            Shape ``(n_timesteps, n_vertices)``.
        group : str
            Network group name (e.g. ``"Visual"``, ``"Auditory"``).
        level : str
            ``"coarse"`` or ``"fine"``.

        Returns
        -------
        np.ndarray
            Shape ``(n_timesteps,)``.
        """
        preds = _validate_preds(preds)
        regions = self.list_regions(group=group, level=level)
        idx = np.concatenate([self.get_vertices(r) for r in regions])
        return preds[:, idx].mean(axis=1)

    def all_group_timeseries(
        self, preds: np.ndarray, level: str = "coarse"
    ) -> pd.DataFrame:
        """Mean activation per functional network group across all timesteps.

        Parameters
        ----------
        preds : np.ndarray
            Shape ``(n_timesteps, n_vertices)``.
        level : str
            ``"coarse"`` or ``"fine"``.

        Returns
        -------
        pd.DataFrame
            Rows = timesteps, columns = group names.
        """
        preds = _validate_preds(preds)
        groups = _get_groups(level)
        data = {}
        for group_name, region_names in groups.items():
            # Collect all vertex indices for this group
            idx_list = []
            for r in region_names:
                try:
                    idx_list.append(self.get_vertices(r))
                except ValueError:
                    continue  # region not present at this mesh resolution
            if idx_list:
                idx = np.concatenate(idx_list)
                data[group_name] = preds[:, idx].mean(axis=1)
        return pd.DataFrame(data)

    # ------------------------------------------------------------------
    # Export
    # ------------------------------------------------------------------

    def to_dataframe(self, preds: np.ndarray) -> pd.DataFrame:
        """Alias for :meth:`all_region_timeseries`."""
        return self.all_region_timeseries(preds)

    def to_csv(self, preds: np.ndarray, path: str) -> None:
        """Write region-level timeseries to a CSV file.

        Parameters
        ----------
        preds : np.ndarray
            Shape ``(n_timesteps, n_vertices)``.
        path : str
            Output file path.
        """
        self.to_dataframe(preds).to_csv(path, index_label="timestep")


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------


def _validate_preds(preds: np.ndarray) -> np.ndarray:
    """Ensure preds is 2D (n_timesteps, n_vertices)."""
    if preds.ndim == 1:
        preds = preds[np.newaxis, :]
    if preds.ndim != 2:
        raise ValueError(
            f"preds must be 1D or 2D, got shape {preds.shape}"
        )
    return preds


def _get_groups(level: str) -> dict[str, list[str]]:
    if level == "coarse":
        return COARSE_GROUPS
    elif level == "fine":
        return FINE_GROUPS
    else:
        raise ValueError(
            f"level must be 'coarse' or 'fine', got {level!r}"
        )
