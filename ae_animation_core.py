from __future__ import annotations

import base64
import io as python_io
import json
import logging
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
import torch
from PIL import Image
from comfy_api.latest import ComfyExtension, io
from typing_extensions import override


class Transform3D:
    """3D transformation matrix builder for AE-style layer transforms."""

    @staticmethod
    def build_model_matrix(
        x: float, y: float, z: float,
        rot_x: float, rot_y: float, rot_z: float,
        scale_x: float, scale_y: float, scale_z: float,
        anchor_x: float, anchor_y: float
    ) -> np.ndarray:
        """
        Build 4x4 model matrix: Anchor offset → Scale → Rotate → Translate
        Rotation order: Z → Y → X (same as AE)
        """
        # Convert degrees to radians
        rx, ry, rz = np.deg2rad(rot_x), np.deg2rad(rot_y), np.deg2rad(rot_z)
        cx, sx = np.cos(rx), np.sin(rx)
        cy, sy = np.cos(ry), np.sin(ry)
        cz, sz = np.cos(rz), np.sin(rz)

        # Rotation matrices
        Rx = np.array([[1, 0, 0, 0], [0, cx, -sx, 0], [0, sx, cx, 0], [0, 0, 0, 1]])
        Ry = np.array([[cy, 0, sy, 0], [0, 1, 0, 0], [-sy, 0, cy, 0], [0, 0, 0, 1]])
        Rz = np.array([[cz, -sz, 0, 0], [sz, cz, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])

        # Scale matrix
        S = np.diag([scale_x, scale_y, scale_z, 1.0])

        # Translation matrix
        T = np.eye(4)
        T[0, 3], T[1, 3], T[2, 3] = x, y, z

        # Anchor offset matrices
        A = np.eye(4)
        A[0, 3], A[1, 3] = -anchor_x, -anchor_y
        A_inv = np.eye(4)
        A_inv[0, 3], A_inv[1, 3] = anchor_x, anchor_y

        # Combined: T * A_inv * Rx * Ry * Rz * S * A
        return T @ A_inv @ Rx @ Ry @ Rz @ S @ A

    @staticmethod
    def build_view_matrix(
        cam_x: float, cam_y: float, cam_z: float,
        yaw: float, pitch: float, roll: float
    ) -> np.ndarray:
        """
        Build 4x4 view matrix from camera position and rotation.
        View matrix is inverse of camera's world transform.
        """
        ry, rp, rr = np.deg2rad(yaw), np.deg2rad(pitch), np.deg2rad(roll)
        cy, sy = np.cos(ry), np.sin(ry)
        cp, sp = np.cos(rp), np.sin(rp)
        cr, sr = np.cos(rr), np.sin(rr)

        # Inverse rotation (transpose)
        Ry_inv = np.array([[cy, 0, -sy, 0], [0, 1, 0, 0], [sy, 0, cy, 0], [0, 0, 0, 1]])
        Rx_inv = np.array([[1, 0, 0, 0], [0, cp, sp, 0], [0, -sp, cp, 0], [0, 0, 0, 1]])
        Rz_inv = np.array([[cr, sr, 0, 0], [-sr, cr, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])

        # Inverse translation
        T_inv = np.eye(4)
        T_inv[0, 3], T_inv[1, 3], T_inv[2, 3] = -cam_x, -cam_y, -cam_z

        # View = R_inv * T_inv (rotate first, then translate)
        return Rz_inv @ Rx_inv @ Ry_inv @ T_inv

    @staticmethod
    def build_projection_matrix(fov_deg: float, aspect: float, near: float = 0.1, far: float = 10000.0) -> np.ndarray:
        """
        Build 4x4 perspective projection matrix.
        FOV is vertical field of view in degrees.
        """
        fov = np.deg2rad(max(1.0, min(179.0, fov_deg)))
        f = 1.0 / np.tan(fov / 2)
        nf = 1.0 / (near - far)

        return np.array([
            [f / aspect, 0, 0, 0],
            [0, f, 0, 0],
            [0, 0, (far + near) * nf, 2 * far * near * nf],
            [0, 0, -1, 0]
        ])

    @staticmethod
    def project_corners(img_w: int, img_h: int, mvp: np.ndarray, screen_w: int, screen_h: int) -> np.ndarray:
        """
        Project image corners through MVP matrix to get 2D screen coordinates.
        Returns 4x2 array of corner positions: [top-left, top-right, bottom-right, bottom-left]
        """
        hw, hh = img_w / 2, img_h / 2
        # 使用标准3D坐标系（Y向上）
        # top = -hh (在屏幕上方), bottom = +hh (在屏幕下方)
        corners = np.array([
            [-hw, -hh, 0, 1],  # top-left
            [hw, -hh, 0, 1],   # top-right
            [hw, hh, 0, 1],    # bottom-right
            [-hw, hh, 0, 1],   # bottom-left
        ])

        projected = (mvp @ corners.T).T
        # Perspective divide
        w = projected[:, 3:4]
        w = np.where(np.abs(w) < 1e-6, 1e-6, w)
        ndc = projected[:, :2] / w

        # NDC to screen coordinates
        # 标准NDC: Y向上，范围[-1,1]
        # 屏幕坐标: Y向下，范围[0,height]
        screen = np.zeros((4, 2))
        screen[:, 0] = (ndc[:, 0] + 1) * 0.5 * screen_w
        screen[:, 1] = (1 - ndc[:, 1]) * 0.5 * screen_h  # Flip Y for screen coords
        return screen.astype(np.float32)

    @staticmethod
    def get_layer_z_depth(
        x: float, y: float, z: float,
        view_matrix: np.ndarray
    ) -> float:
        """Get the Z depth of a layer center after view transform (for sorting)."""
        point = np.array([x, y, z, 1])
        transformed = view_matrix @ point
        return transformed[2]


def _parse_layers(layers_json: str) -> Dict[str, Any]:
    if not layers_json:
        return {"layers": [], "project_keyframes": {}, "project": {}}
    try:
        data = json.loads(layers_json)
        if isinstance(data, list):
            return {"layers": data, "project_keyframes": {}, "project": {}}
        if isinstance(data, dict):
            project = data.get("project") or {}
            # project_keyframes 可能在 project 内部或顶层
            project_kf = project.get("project_keyframes") or data.get("project_keyframes") or {}
            return {
                "layers": data.get("layers") or [],
                "project_keyframes": project_kf,
                "project": project
            }
    except Exception:
        logging.warning("[AE] Failed to parse layers_keyframes JSON")
    return {"layers": [], "project_keyframes": {}, "project": {}}


class AEAnimation(io.ComfyNode):
    """
    Single node that reads timeline data from the AE Timeline UI (layers_keyframes)
    and directly renders frames + masks.
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        schema = io.Schema(
            node_id="AEAnimation",
            display_name="AE Animation",
            category="AE Animation",
            inputs=[
                io.Int.Input("width", default=1280, min=64, max=8192),
                io.Int.Input("height", default=720, min=64, max=8192),
                io.Int.Input("fps", default=16, min=1, max=120),
                io.Int.Input("total_frames", default=81, min=1, max=9999),
                io.Int.Input("mask_expansion", default=0, min=-255, max=255),
                io.Int.Input("mask_feather", default=0, min=0, max=100),
                io.Int.Input("cam_enable", default=0, min=0, max=1, optional=True),
                io.Int.Input("pano_enable", default=0, min=0, max=1, optional=True),
                io.Float.Input("cam_pos_x", default=0.0, optional=True),
                io.Float.Input("cam_pos_y", default=0.0, optional=True),
                io.Float.Input("cam_pos_z", default=1000.0, optional=True),
                io.Float.Input("cam_yaw", default=0.0, optional=True),
                io.Float.Input("cam_pitch", default=0.0, optional=True),
                io.Float.Input("cam_roll", default=0.0, optional=True),
                io.Float.Input("cam_fov", default=90.0, optional=True),
                io.String.Input("layers_keyframes", default="[]", multiline=True),
                io.Int.Input("start_frame", default=0, min=0),
                io.Int.Input("end_frame", default=-1, min=-1),
            ],
            outputs=[
                io.Image.Output("frames"),
                io.Mask.Output("mask_frames"),
            ],
        )
        schema.output_node = True
        return schema

    @staticmethod
    def _get_value(keyframes: Dict[str, Any], prop: str, time: float, default: float) -> float:
        if prop not in keyframes:
            return default
        frames_data = keyframes[prop]
        if not isinstance(frames_data, list):
            return default
        frames = [f for f in frames_data if isinstance(f, dict) and "time" in f and "value" in f]
        if not frames:
            return default
        frames.sort(key=lambda k: k["time"])
        if time <= frames[0]["time"]:
            return frames[0]["value"]
        if time >= frames[-1]["time"]:
            return frames[-1]["value"]
        for idx in range(len(frames) - 1):
            k1, k2 = frames[idx], frames[idx + 1]
            if k1["time"] <= time <= k2["time"]:
                duration = k2["time"] - k1["time"]
                t = (time - k1["time"]) / duration if duration > 0 else 0
                return k1["value"] + (k2["value"] - k1["value"]) * t
        return default

    @staticmethod
    def _calculate_bezier_pos(path_points: List[Dict[str, float]], time: float, duration: float) -> Optional[Tuple[float, float]]:
        if not path_points or len(path_points) < 2:
            return None
        t_norm = max(0.0, min(1.0, time / duration)) if duration > 0 else 0
        total_segments = len(path_points) - 1
        current_segment = min(int(t_norm * total_segments), total_segments - 1)
        segment_t = (t_norm * total_segments) - current_segment

        p0, p1 = path_points[current_segment], path_points[current_segment + 1]
        p0_x, p0_y = p0.get("x", 0), p0.get("y", 0)
        p1_x, p1_y = p1.get("x", 0), p1.get("y", 0)
        cp1_x = p0.get("cp2x", p0_x + (p1_x - p0_x) / 3.0)
        cp1_y = p0.get("cp2y", p0_y + (p1_y - p0_y) / 3.0)
        cp2_x = p1.get("cp1x", p0_x + (p1_x - p0_x) * 2.0 / 3.0)
        cp2_y = p1.get("cp1y", p0_y + (p1_y - p0_y) * 2.0 / 3.0)

        mt = 1 - segment_t
        x = mt**3 * p0_x + 3 * mt**2 * segment_t * cp1_x + 3 * mt * segment_t**2 * cp2_x + segment_t**3 * p1_x
        y = mt**3 * p0_y + 3 * mt**2 * segment_t * cp1_y + 3 * mt * segment_t**2 * cp2_y + segment_t**3 * p1_y
        return x, y

    @classmethod
    def _decode_layers(cls, layers: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        decoded = []
        for layer in layers:
            try:
                img_b64 = layer.get("image_data", "")
                if not img_b64:
                    continue
                img_data = base64.b64decode(img_b64.split(",", 1)[1])
                pil = Image.open(python_io.BytesIO(img_data)).convert("RGBA")
                decoded.append({
                    "data": np.array(pil),
                    "keyframes": layer.get("keyframes", {}),
                    "type": layer.get("type", "foreground"),
                    "bg_mode": layer.get("bg_mode", "fit"),
                    "customMask": layer.get("customMask"),
                    "bezierPath": layer.get("bezierPath"),
                    "usePathAnimation": layer.get("usePathAnimation", False),
                    # Position
                    "x": layer.get("x", 0),
                    "y": layer.get("y", 0),
                    "z": layer.get("z", 0),
                    # 3D Rotation
                    "rotationX": layer.get("rotationX", 0),
                    "rotationY": layer.get("rotationY", 0),
                    "rotationZ": layer.get("rotationZ", layer.get("rotation", 0)),
                    # 3D Scale
                    "scaleX": layer.get("scaleX", layer.get("scale", 1.0)),
                    "scaleY": layer.get("scaleY", layer.get("scale", 1.0)),
                    "scaleZ": layer.get("scaleZ", 1.0),
                    # Anchor point
                    "anchorX": layer.get("anchorX", 0),
                    "anchorY": layer.get("anchorY", 0),
                    # Other
                    "opacity": layer.get("opacity", 1.0),
                    "is3D": layer.get("is3D", False),
                    # Legacy (for backward compatibility)
                    "scale": layer.get("scale", 1.0),
                    "rotation": layer.get("rotation", 0),
                })
            except Exception:
                continue
        return decoded

    @staticmethod
    def _build_pano_map(dst_w: int, dst_h: int, fov_deg: float, yaw_deg: float, pitch_deg: float, roll_deg: float, src_w: int, src_h: int) -> Tuple[np.ndarray, np.ndarray]:
        i, j = np.meshgrid(np.arange(dst_w), np.arange(dst_h))
        fov = np.deg2rad(max(1.0, min(179.0, fov_deg)))
        aspect = dst_w / max(1e-6, dst_h)
        x = (i + 0.5) / dst_w * 2 - 1
        y = (j + 0.5) / dst_h * 2 - 1
        x = x * np.tan(fov / 2) * aspect
        y = -y * np.tan(fov / 2)
        z = np.ones_like(x)
        dirs = np.stack([x, y, z], axis=-1)
        dirs = dirs / (np.linalg.norm(dirs, axis=-1, keepdims=True) + 1e-8)

        cy, sy = np.cos(np.deg2rad(yaw_deg)), np.sin(np.deg2rad(yaw_deg))
        cp, sp = np.cos(np.deg2rad(pitch_deg)), np.sin(np.deg2rad(pitch_deg))
        cr, sr = np.cos(np.deg2rad(roll_deg)), np.sin(np.deg2rad(roll_deg))
        Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
        Rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
        Rz = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])
        dirs_rot = dirs @ (Rz @ Rx @ Ry).T

        lon = np.arctan2(dirs_rot[..., 0], dirs_rot[..., 2])
        lat = np.arcsin(np.clip(dirs_rot[..., 1], -1.0, 1.0))
        map_x = ((lon / (2 * np.pi)) + 0.5) * src_w
        map_y = ((-lat / np.pi) + 0.5) * src_h
        return map_x.astype(np.float32), map_y.astype(np.float32)

    @staticmethod
    def _render_layer_3d(
        img_np: np.ndarray,
        mvp: np.ndarray,
        canvas: np.ndarray,
        mask_canvas: np.ndarray,
        opacity: float,
        is_foreground: bool,
        width: int,
        height: int
    ) -> None:
        """Render a layer with 3D perspective transform."""
        img_h, img_w = img_np.shape[:2]
        dst_corners = Transform3D.project_corners(img_w, img_h, mvp, width, height)

        # Check if layer is visible (all corners within reasonable bounds)
        if np.any(dst_corners < -width * 2) or np.any(dst_corners > width * 3):
            return

        # Source corners (original image)
        src_corners = np.array([
            [0, 0], [img_w, 0], [img_w, img_h], [0, img_h]
        ], dtype=np.float32)

        # Get perspective transform matrix
        try:
            M = cv2.getPerspectiveTransform(src_corners, dst_corners)
            warped = cv2.warpPerspective(img_np, M, (width, height), borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
        except cv2.error:
            return

        # Update mask for foreground
        if is_foreground and warped.shape[2] == 4:
            mask_layer = (warped[:, :, 3].astype(np.float32) * opacity).astype(np.uint8)
            mask_canvas[:] = np.maximum(mask_canvas, mask_layer)

        # Composite
        if warped.shape[2] == 4:
            alpha = (warped[:, :, 3:4].astype(np.float32) / 255.0) * opacity
            for c in range(3):
                canvas[:, :, c] = (canvas[:, :, c] * (1 - alpha[:, :, 0]) + warped[:, :, c] * alpha[:, :, 0]).astype(np.uint8)
            canvas[:, :, 3] = np.maximum(canvas[:, :, 3], (alpha[:, :, 0] * 255).astype(np.uint8))

    @staticmethod
    def _render_layer_2d_with_3d_rotation(
        img_np: np.ndarray,
        x: float, y: float,
        scale: float,
        rot_x: float, rot_y: float, rot_z: float,
        canvas: np.ndarray,
        mask_canvas: np.ndarray,
        opacity: float,
        is_foreground: bool,
        width: int,
        height: int,
        perspective: float = 1000.0,
        bg_mode: str = "fit"
    ) -> None:
        """Render a layer with 3D rotation using perspective transform."""
        orig_w, orig_h = img_np.shape[1], img_np.shape[0]

        # Background scaling
        base_scale = 1.0
        if not is_foreground:
            if bg_mode == "fit":
                base_scale = min(width / orig_w, height / orig_h)
            elif bg_mode == "fill":
                base_scale = max(width / orig_w, height / orig_h)
            elif bg_mode == "stretch":
                base_scale = min(width / orig_w, height / orig_h)
        
        final_scale = base_scale * scale
        if final_scale != 1.0 and final_scale > 0:
            new_w, new_h = max(1, int(orig_w * final_scale)), max(1, int(orig_h * final_scale))
            img_np = cv2.resize(img_np, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

        current_w, current_h = img_np.shape[1], img_np.shape[0]
        
        # 检查是否需要 3D 旋转
        has_3d_rotation = abs(rot_x) > 0.1 or abs(rot_y) > 0.1 or abs(rot_z) > 0.1
        
        if has_3d_rotation:
            # 转换为弧度
            rx = np.deg2rad(rot_x)
            ry = np.deg2rad(rot_y)
            rz = np.deg2rad(rot_z)
            
            # 旋转矩阵
            cos_x, sin_x = np.cos(rx), np.sin(rx)
            cos_y, sin_y = np.cos(ry), np.sin(ry)
            cos_z, sin_z = np.cos(rz), np.sin(rz)
            
            # 原始四个角点（相对于中心，与前端GPU渲染器一致）
            # 前端WebGPU使用Y向上的坐标系，y=hh是bottom，y=-hh是top
            # 后端图像坐标系Y向下，所以需要在投影后翻转Y
            hw, hh = current_w / 2, current_h / 2
            # 顺序与前端一致：bottom-left, bottom-right, top-right, top-left
            # 对应src_pts的顺序：[0,h], [w,h], [w,0], [0,0]
            corners_3d = np.array([
                [-hw, hh, 0],   # bottom-left (前端y=hh是bottom)
                [hw, hh, 0],    # bottom-right
                [hw, -hh, 0],   # top-right (前端y=-hh是top)
                [-hw, -hh, 0]   # top-left
            ], dtype=np.float64)
            
            # 应用 3D 旋转（顺序：Z -> Y -> X，与前端一致）
            transformed = []
            for p in corners_3d:
                px, py, pz = p
                
                # Z 轴旋转
                x1 = px * cos_z - py * sin_z
                y1 = px * sin_z + py * cos_z
                z1 = pz
                
                # Y 轴旋转
                x2 = x1 * cos_y + z1 * sin_y
                z2 = -x1 * sin_y + z1 * cos_y
                y2 = y1
                
                # X 轴旋转
                y3 = y2 * cos_x - z2 * sin_x
                z3 = y2 * sin_x + z2 * cos_x
                x3 = x2
                
                # 透视投影
                proj_scale = perspective / (perspective + z3)
                proj_x = x3 * proj_scale
                # 不翻转Y轴，因为src_pts已经按照正确的顺序排列
                proj_y = y3 * proj_scale
                
                transformed.append([proj_x, proj_y])
            
            # 源角点（图像坐标系，Y向下）
            # 顺序与corners_3d一致：bottom-left, bottom-right, top-right, top-left
            src_pts = np.array([
                [0, current_h],      # bottom-left
                [current_w, current_h],  # bottom-right
                [current_w, 0],      # top-right
                [0, 0]               # top-left
            ], dtype=np.float32)
            
            # 目标角点（加上画布中心偏移）
            center_x = width / 2 + x
            center_y = height / 2 + y
            dst_pts = np.array([
                [center_x + transformed[0][0], center_y + transformed[0][1]],
                [center_x + transformed[1][0], center_y + transformed[1][1]],
                [center_x + transformed[2][0], center_y + transformed[2][1]],
                [center_x + transformed[3][0], center_y + transformed[3][1]]
            ], dtype=np.float32)
            
            # 检查目标点是否在合理范围内
            if np.any(dst_pts < -width * 2) or np.any(dst_pts > width * 3):
                return
            
            # 透视变换
            try:
                M = cv2.getPerspectiveTransform(src_pts, dst_pts)
                warped = cv2.warpPerspective(img_np, M, (width, height), 
                                            borderMode=cv2.BORDER_CONSTANT, 
                                            borderValue=(0, 0, 0, 0))
            except cv2.error:
                return
            
            # 合成到画布
            if is_foreground and warped.shape[2] == 4:
                mask_layer = (warped[:, :, 3].astype(np.float32) * opacity).astype(np.uint8)
                mask_canvas[:] = np.maximum(mask_canvas, mask_layer)
            
            if warped.shape[2] == 4:
                alpha = (warped[:, :, 3:4].astype(np.float32) / 255.0) * opacity
                for c in range(3):
                    canvas[:, :, c] = (canvas[:, :, c] * (1 - alpha[:, :, 0]) + 
                                      warped[:, :, c] * alpha[:, :, 0]).astype(np.uint8)
                canvas[:, :, 3] = np.maximum(canvas[:, :, 3], (alpha[:, :, 0] * 255).astype(np.uint8))
            return
        
        # 无 3D 旋转时使用简单的粘贴
        paste_x = int(width // 2 + x - current_w // 2)
        paste_y = int(height // 2 + y - current_h // 2)

        # Update mask for foreground
        if is_foreground and img_np.shape[2] == 4:
            mask_layer = (img_np[:, :, 3].astype(np.float32) * opacity).astype(np.uint8)
            y1, x1 = max(0, paste_y), max(0, paste_x)
            y2, x2 = min(paste_y + current_h, height), min(paste_x + current_w, width)
            if y2 > y1 and x2 > x1:
                sy, sx = max(0, -paste_y), max(0, -paste_x)
                src = mask_layer[sy:sy + (y2 - y1), sx:sx + (x2 - x1)]
                mask_canvas[y1:y2, x1:x2] = np.maximum(mask_canvas[y1:y2, x1:x2], src)

        # Composite
        y1, x1 = max(0, paste_y), max(0, paste_x)
        y2, x2 = min(paste_y + current_h, height), min(paste_x + current_w, width)
        if y2 > y1 and x2 > x1:
            sy, sx = max(0, -paste_y), max(0, -paste_x)
            src = img_np[sy:sy + (y2 - y1), sx:sx + (x2 - x1)]
            dst = canvas[y1:y2, x1:x2]
            if src.shape[2] == 4:
                alpha = (src[:, :, 3:4].astype(np.float32) / 255.0) * opacity
                for c in range(3):
                    dst[:, :, c] = (dst[:, :, c] * (1 - alpha[:, :, 0]) + src[:, :, c] * alpha[:, :, 0]).astype(np.uint8)
                dst[:, :, 3] = np.maximum(dst[:, :, 3], (alpha[:, :, 0] * 255).astype(np.uint8))

    @staticmethod
    def _render_layer_2d(
        img_np: np.ndarray,
        x: float, y: float,
        scale: float, rotation: float,
        canvas: np.ndarray,
        mask_canvas: np.ndarray,
        opacity: float,
        is_foreground: bool,
        width: int,
        height: int,
        bg_mode: str = "fit"
    ) -> None:
        """Render a layer with 2D transform (legacy mode)."""
        orig_w, orig_h = img_np.shape[1], img_np.shape[0]

        # Background scaling
        if not is_foreground:
            if bg_mode == "fit":
                base_scale = min(width / orig_w, height / orig_h)
            elif bg_mode == "fill":
                base_scale = max(width / orig_w, height / orig_h)
            elif bg_mode == "stretch":
                new_w, new_h = max(1, int(width * scale)), max(1, int(height * scale))
                img_np = cv2.resize(img_np, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
                base_scale = None
            else:
                base_scale = 1.0
            if base_scale is not None:
                final_scale = base_scale * scale
                new_w, new_h = max(1, int(orig_w * final_scale)), max(1, int(orig_h * final_scale))
                img_np = cv2.resize(img_np, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
        elif scale != 1.0 and scale > 0:
            new_w, new_h = max(1, int(orig_w * scale)), max(1, int(orig_h * scale))
            img_np = cv2.resize(img_np, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

        current_w, current_h = img_np.shape[1], img_np.shape[0]

        if abs(rotation) > 0.1:
            center = (current_w // 2, current_h // 2)
            matrix = cv2.getRotationMatrix2D(center, rotation, 1.0)
            img_np = cv2.warpAffine(img_np, matrix, (current_w, current_h), borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))

        paste_x = int(width // 2 + x - current_w // 2)
        paste_y = int(height // 2 + y - current_h // 2)

        # Update mask for foreground
        if is_foreground:
            mask_layer = (img_np[:, :, 3].astype(np.float32) * opacity).astype(np.uint8)
            y1, x1 = max(0, paste_y), max(0, paste_x)
            y2, x2 = min(paste_y + current_h, height), min(paste_x + current_w, width)
            if y2 > y1 and x2 > x1:
                sy, sx = max(0, -paste_y), max(0, -paste_x)
                src = mask_layer[sy:sy + (y2 - y1), sx:sx + (x2 - x1)]
                mask_canvas[y1:y2, x1:x2] = np.maximum(mask_canvas[y1:y2, x1:x2], src)

        # Composite
        y1, x1 = max(0, paste_y), max(0, paste_x)
        y2, x2 = min(paste_y + current_h, height), min(paste_x + current_w, width)
        if y2 > y1 and x2 > x1:
            sy, sx = max(0, -paste_y), max(0, -paste_x)
            src = img_np[sy:sy + (y2 - y1), sx:sx + (x2 - x1)]
            dst = canvas[y1:y2, x1:x2]
            alpha = (src[:, :, 3:4].astype(np.float32) / 255.0) * opacity
            for c in range(3):
                dst[:, :, c] = (dst[:, :, c] * (1 - alpha[:, :, 0]) + src[:, :, c] * alpha[:, :, 0]).astype(np.uint8)
            dst[:, :, 3] = np.maximum(dst[:, :, 3], (alpha[:, :, 0] * 255).astype(np.uint8))

    @classmethod
    def execute(
        cls,
        width: int,
        height: int,
        fps: int,
        total_frames: int,
        mask_expansion: int,
        mask_feather: int,
        cam_enable: int = 0,
        pano_enable: int = 0,
        cam_pos_x: float = 0.0,
        cam_pos_y: float = 0.0,
        cam_pos_z: float = 1000.0,
        cam_yaw: float = 0.0,
        cam_pitch: float = 0.0,
        cam_roll: float = 0.0,
        cam_fov: float = 90.0,
        layers_keyframes: str = "",
        start_frame: int = 0,
        end_frame: int = -1,
    ) -> io.NodeOutput:
        parsed = _parse_layers(layers_keyframes)
        layers_data = parsed["layers"]
        project_kf = parsed["project_keyframes"]
        project_data = parsed.get("project", {})

        duration = total_frames / max(fps, 1)
        
        # 优先使用 project_data 中的设置（来自 layers_keyframes JSON），如果没有则使用节点 widget 的值
        pano_enable_final = bool(project_data.get("pano_enable")) if project_data.get("pano_enable") is not None else bool(pano_enable)
        cam_enable_final = bool(project_data.get("cam_enable")) if project_data.get("cam_enable") is not None else bool(cam_enable)
        cam_yaw_final = float(project_data.get("cam_yaw", cam_yaw) or 0)
        cam_pitch_final = float(project_data.get("cam_pitch", cam_pitch) or 0)
        cam_roll_final = float(project_data.get("cam_roll", cam_roll) or 0)
        cam_fov_final = float(project_data.get("cam_fov", cam_fov) or 90)
        cam_pos_x_final = float(project_data.get("cam_pos_x", cam_pos_x) or 0)
        cam_pos_y_final = float(project_data.get("cam_pos_y", cam_pos_y) or 0)
        cam_pos_z_final = float(project_data.get("cam_pos_z", cam_pos_z) or 1000)
        
        pano_enabled = bool(pano_enable_final)
        camera_active = bool(cam_enable_final) or pano_enabled
        aspect = width / max(1, height)

        if end_frame == -1 or end_frame > total_frames:
            end_frame = total_frames

        layers = cls._decode_layers(layers_data)
        print(f"[AE] Render: {width}x{height}, frames {start_frame}-{end_frame}/{total_frames}, {len(layers)} layers")
        print(f"[AE] Camera: pano_enabled={pano_enabled}, camera_active={camera_active}, yaw={cam_yaw_final}, pitch={cam_pitch_final}, fov={cam_fov_final}")

        def interp_kf(prop: str, default: float, t: float) -> float:
            arr = project_kf.get(prop) if isinstance(project_kf, dict) else None
            if not arr:
                return default
            try:
                arr_sorted = sorted(arr, key=lambda k: k.get("time", 0))
                if t <= arr_sorted[0]["time"]:
                    return arr_sorted[0]["value"]
                if t >= arr_sorted[-1]["time"]:
                    return arr_sorted[-1]["value"]
                for i in range(len(arr_sorted) - 1):
                    t1, t2 = arr_sorted[i]["time"], arr_sorted[i + 1]["time"]
                    if t1 <= t <= t2:
                        alpha = (t - t1) / (t2 - t1) if t2 > t1 else 0
                        return arr_sorted[i]["value"] + (arr_sorted[i + 1]["value"] - arr_sorted[i]["value"]) * alpha
            except Exception:
                pass
            return default

        frames: List[torch.Tensor] = []
        masks: List[torch.Tensor] = []
        pano_cache: Optional[Tuple[np.ndarray, np.ndarray, float, float, float, float]] = None

        for frame_idx in range(start_frame, end_frame):
            time = frame_idx / max(fps, 1)

            # Camera parameters (使用 _final 变量作为默认值)
            cam_yaw_t = interp_kf("cam_yaw", cam_yaw_final, time)
            cam_pitch_t = interp_kf("cam_pitch", cam_pitch_final, time)
            cam_roll_t = interp_kf("cam_roll", cam_roll_final, time)
            cam_fov_t = interp_kf("cam_fov", cam_fov_final, time)
            cam_pos_x_t = interp_kf("cam_pos_x", cam_pos_x_final, time)
            cam_pos_y_t = interp_kf("cam_pos_y", cam_pos_y_final, time)
            cam_pos_z_t = interp_kf("cam_pos_z", cam_pos_z_final, time)

            # Build camera matrices
            view_matrix = Transform3D.build_view_matrix(cam_pos_x_t, cam_pos_y_t, cam_pos_z_t, cam_yaw_t, cam_pitch_t, cam_roll_t)
            proj_matrix = Transform3D.build_projection_matrix(cam_fov_t, aspect)
            vp_matrix = proj_matrix @ view_matrix

            canvas = np.zeros((height, width, 4), dtype=np.uint8)
            mask_canvas = np.zeros((height, width), dtype=np.uint8)

            # Collect layer data with Z-depth for sorting
            layer_render_data = []
            for layer in layers:
                kf = layer.get("keyframes", {})
                is_foreground = layer["type"] == "foreground"
                is_pano_bg = pano_enabled and not is_foreground
                is_3d = layer.get("is3D", False)

                # Get animated properties
                x = cls._get_value(kf, "x", time, layer["x"])
                y = cls._get_value(kf, "y", time, layer["y"])
                z = cls._get_value(kf, "z", time, layer["z"])

                # Bezier path override (only if usePathAnimation is enabled)
                use_path_animation = layer.get("usePathAnimation", False)
                bezier_path = layer.get("bezierPath")
                if use_path_animation and bezier_path and len(bezier_path) >= 2:
                    pos = cls._calculate_bezier_pos(bezier_path, time, duration)
                    if pos:
                        x, y = pos

                # 3D properties
                rot_x = cls._get_value(kf, "rotationX", time, layer["rotationX"])
                rot_y = cls._get_value(kf, "rotationY", time, layer["rotationY"])
                rot_z = cls._get_value(kf, "rotationZ", time, layer["rotationZ"])
                scale_x = cls._get_value(kf, "scaleX", time, layer["scaleX"])
                scale_y = cls._get_value(kf, "scaleY", time, layer["scaleY"])
                scale_z = cls._get_value(kf, "scaleZ", time, layer["scaleZ"])
                anchor_x = cls._get_value(kf, "anchorX", time, layer["anchorX"])
                anchor_y = cls._get_value(kf, "anchorY", time, layer["anchorY"])
                opacity = cls._get_value(kf, "opacity", time, layer["opacity"])

                # Legacy 2D properties
                scale_2d = cls._get_value(kf, "scale", time, layer["scale"])
                rotation_2d = cls._get_value(kf, "rotation", time, layer["rotation"])

                # Calculate Z-depth for sorting
                z_depth = Transform3D.get_layer_z_depth(x, y, z, view_matrix) if (is_3d or camera_active) else -z

                layer_render_data.append({
                    "layer": layer,
                    "x": x, "y": y, "z": z,
                    "rot_x": rot_x, "rot_y": rot_y, "rot_z": rot_z,
                    "scale_x": scale_x, "scale_y": scale_y, "scale_z": scale_z,
                    "anchor_x": anchor_x, "anchor_y": anchor_y,
                    "opacity": opacity,
                    "scale_2d": scale_2d, "rotation_2d": rotation_2d,
                    "is_3d": is_3d, "is_foreground": is_foreground, "is_pano_bg": is_pano_bg,
                    "z_depth": z_depth,
                })

            # Sort by layer type then Z-depth (backgrounds first, far to near)
            layer_render_data.sort(key=lambda d: (d["is_foreground"], -d["z_depth"]))

            # Render layers
            for data in layer_render_data:
                layer = data["layer"]
                img_np = layer["data"].copy()
                is_foreground = data["is_foreground"]
                is_pano_bg = data["is_pano_bg"]
                is_3d = data["is_3d"]
                opacity = data["opacity"]

                # Apply custom mask
                if is_foreground and layer.get("customMask"):
                    try:
                        mask_b64 = layer["customMask"].split(",")[1]
                        mask_img = Image.open(python_io.BytesIO(base64.b64decode(mask_b64))).convert("RGBA")
                        mask_np = np.array(mask_img)
                        if mask_np.shape[:2] != img_np.shape[:2]:
                            mask_np = cv2.resize(mask_np, (img_np.shape[1], img_np.shape[0]), interpolation=cv2.INTER_LINEAR)
                        img_np[:, :, 3] = (img_np[:, :, 3].astype(np.float32) * mask_np[:, :, 3] / 255.0).astype(np.uint8)
                    except Exception as e:
                        print(f"[AE] Custom mask error: {e}")

                # Panorama background
                if is_pano_bg:
                    cache_key = (cam_fov_t, cam_yaw_t, cam_pitch_t, cam_roll_t)
                    if pano_cache is None or pano_cache[2:] != cache_key:
                        map_x, map_y = cls._build_pano_map(width, height, cam_fov_t, cam_yaw_t, cam_pitch_t, cam_roll_t, img_np.shape[1], img_np.shape[0])
                        pano_cache = (map_x, map_y, *cache_key)
                    img_np = cv2.remap(img_np, pano_cache[0], pano_cache[1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
                    cls._render_layer_2d(img_np, 0, 0, 1.0, 0, canvas, mask_canvas, opacity, is_foreground, width, height, "fit")
                elif pano_enabled and is_foreground:
                    # Pano模式下前景图层使用2D渲染，但需要跟随摄像机旋转
                    fg_x = data["x"]
                    fg_y = data["y"]
                    
                    # 根据摄像机 yaw/pitch 计算前景偏移（与前端逻辑一致）
                    if cam_yaw_t != 0 or cam_pitch_t != 0:
                        yaw_rad = np.deg2rad(cam_yaw_t)
                        pitch_rad = np.deg2rad(cam_pitch_t)
                        fov_rad = np.deg2rad(max(1.0, min(179.0, cam_fov_t)))
                        fov_factor = np.tan(fov_rad / 2)
                        move_scale = width / (2 * fov_factor)
                        fg_x -= np.tan(yaw_rad) * move_scale
                        fg_y -= np.tan(pitch_rad) * move_scale
                    
                    # Check if has 3D rotation
                    has_3d_rotation = abs(data["rot_x"]) > 0.1 or abs(data["rot_y"]) > 0.1 or abs(data["rot_z"]) > 0.1
                    if has_3d_rotation:
                        cls._render_layer_2d_with_3d_rotation(
                            img_np, fg_x, fg_y, data["scale_2d"],
                            data["rot_x"], data["rot_y"], data["rot_z"],
                            canvas, mask_canvas, opacity, is_foreground, width, height,
                            perspective=1000.0, bg_mode="fit"
                        )
                    else:
                        cls._render_layer_2d(
                            img_np, fg_x, fg_y, data["scale_2d"], data["rotation_2d"],
                            canvas, mask_canvas, opacity, is_foreground, width, height, "fit"
                        )
                elif is_3d:
                    # 真正的3D图层使用完整的MVP矩阵变换
                    model_matrix = Transform3D.build_model_matrix(
                        data["x"], data["y"], data["z"],
                        data["rot_x"], data["rot_y"], data["rot_z"],
                        data["scale_x"], data["scale_y"], data["scale_z"],
                        data["anchor_x"], data["anchor_y"]
                    )
                    mvp = vp_matrix @ model_matrix
                    cls._render_layer_3d(img_np, mvp, canvas, mask_canvas, opacity, is_foreground, width, height)
                elif camera_active:
                    # camera-only模式：使用与前端一致的简单变换
                    # 摄像机位置影响图层偏移（反向）
                    layer_x = data["x"] - cam_pos_x_t
                    layer_y = data["y"] - cam_pos_y_t
                    
                    # 摄像机旋转影响图层位置
                    if cam_yaw_t != 0 or cam_pitch_t != 0:
                        yaw_rad = np.deg2rad(cam_yaw_t)
                        pitch_rad = np.deg2rad(cam_pitch_t)
                        fov_rad = np.deg2rad(max(1.0, min(179.0, cam_fov_t)))
                        fov_factor = np.tan(fov_rad / 2)
                        move_scale = width / (2 * fov_factor)
                        layer_x += np.tan(yaw_rad) * move_scale
                        layer_y += np.tan(pitch_rad) * move_scale
                    
                    # 摄像机Z轴产生的缩放效果
                    camera_z_scale = max(0.1, min(10, 1000 / max(100, cam_pos_z_t)))
                    final_scale = data["scale_2d"] * camera_z_scale
                    
                    # 检查是否有3D旋转
                    has_3d_rotation = abs(data["rot_x"]) > 0.1 or abs(data["rot_y"]) > 0.1 or abs(data["rot_z"]) > 0.1
                    if has_3d_rotation:
                        cls._render_layer_2d_with_3d_rotation(
                            img_np, layer_x, layer_y, final_scale,
                            data["rot_x"], data["rot_y"], data["rot_z"],
                            canvas, mask_canvas, opacity, is_foreground, width, height,
                            perspective=1000.0, bg_mode=layer["bg_mode"]
                        )
                    else:
                        cls._render_layer_2d(
                            img_np, layer_x, layer_y, final_scale, data["rotation_2d"],
                            canvas, mask_canvas, opacity, is_foreground, width, height, layer["bg_mode"]
                        )
                else:
                    # 2D rendering - check if has 3D rotation
                    has_3d_rotation = abs(data["rot_x"]) > 0.1 or abs(data["rot_y"]) > 0.1 or abs(data["rot_z"]) > 0.1
                    if has_3d_rotation:
                        cls._render_layer_2d_with_3d_rotation(
                            img_np, data["x"], data["y"], data["scale_2d"],
                            data["rot_x"], data["rot_y"], data["rot_z"],
                            canvas, mask_canvas, opacity, is_foreground, width, height,
                            perspective=1000.0, bg_mode=layer["bg_mode"]
                        )
                    else:
                        cls._render_layer_2d(
                            img_np, data["x"], data["y"], data["scale_2d"], data["rotation_2d"],
                            canvas, mask_canvas, opacity, is_foreground, width, height, layer["bg_mode"]
                        )

            # Post-processing
            if mask_expansion != 0:
                kernel = np.ones((3, 3), np.uint8)
                op = cv2.dilate if mask_expansion > 0 else cv2.erode
                mask_canvas = op(mask_canvas, kernel, iterations=abs(mask_expansion))
            if mask_feather > 0:
                ksize = max(3, mask_feather * 2 + 1)
                mask_canvas = cv2.GaussianBlur(mask_canvas, (ksize, ksize), 0)

            frames.append(torch.from_numpy(canvas[:, :, :3].astype(np.float32) / 255.0))
            masks.append(torch.from_numpy(mask_canvas.astype(np.float32) / 255.0))

        if not frames:
            return io.NodeOutput(torch.zeros((1, 64, 64, 3)), torch.zeros((1, 64, 64)))

        return io.NodeOutput(torch.stack(frames), torch.stack(masks))


class AEAnimationExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> List[type[io.ComfyNode]]:
        return [AEAnimation]


async def comfy_entrypoint() -> AEAnimationExtension:
    return AEAnimationExtension()
