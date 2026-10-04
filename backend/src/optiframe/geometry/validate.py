"""Printability checks shared by STL generation and order intake."""

import io
from dataclasses import dataclass

import numpy as np
import trimesh
from manifold3d import Manifold

from optiframe.geometry.frame import MAX_BED_MM


@dataclass
class MeshReport:
    ok: bool
    problems: list[str]
    volume_mm3: float
    extents_mm: list[float]
    triangles: int


def manifold_to_trimesh(m: Manifold) -> trimesh.Trimesh:
    mesh = m.to_mesh()
    verts = np.asarray(mesh.vert_properties)[:, :3]
    faces = np.asarray(mesh.tri_verts)
    return trimesh.Trimesh(vertices=verts, faces=faces, process=True)


def check_mesh(mesh: trimesh.Trimesh) -> MeshReport:
    problems = []
    if len(mesh.faces) == 0:
        return MeshReport(False, ["empty mesh"], 0.0, [0, 0, 0], 0)
    if not mesh.is_watertight:
        problems.append("not watertight")
    if not mesh.is_winding_consistent:
        problems.append("inconsistent winding")
    volume = float(mesh.volume) if mesh.is_watertight else 0.0
    if volume <= 0:
        problems.append("non-positive volume")
    if mesh.body_count != 1:
        problems.append(f"{mesh.body_count} separate bodies")
    ext = [float(e) for e in mesh.extents]
    if max(ext[0], ext[1]) > MAX_BED_MM or ext[2] > MAX_BED_MM:
        problems.append("larger than the printer bed")
    return MeshReport(not problems, problems, volume, ext, int(len(mesh.faces)))


def load_stl(data: bytes) -> trimesh.Trimesh | None:
    try:
        mesh = trimesh.load(io.BytesIO(data), file_type="stl", force="mesh", process=True)
    except Exception:
        return None
    return mesh if isinstance(mesh, trimesh.Trimesh) else None


def stl_bytes(mesh: trimesh.Trimesh) -> bytes:
    return mesh.export(file_type="stl")
