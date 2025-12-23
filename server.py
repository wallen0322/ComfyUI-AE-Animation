from aiohttp import web
import base64
import hashlib
import io as python_io
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import quote

import numpy as np
from PIL import Image

try:
    from rembg import remove, new_session
    REMBG_AVAILABLE = True
except ImportError:
    try:
        from rembg import remove
        new_session = None
        REMBG_AVAILABLE = True
    except ImportError:
        REMBG_AVAILABLE = False
        new_session = None
        logging.warning("[AE] rembg not available. Install with: pip install rembg")

REMBG_SESSION_CACHE: Dict[str, Any] = {}

try:
    import folder_paths  # type: ignore
except Exception:
    folder_paths = None


DEFAULT_ASSET_SUBFOLDER = "ae_animation"
ALLOWED_ASSET_TYPES = {"input", "output"}
ALLOWED_ASSET_EXTS = {"png", "jpg", "jpeg", "webp"}


def _safe_rel_subfolder(value: str) -> str:
    value = (value or "").strip().replace("\\", "/")
    value = value.strip("/")
    parts = [p for p in value.split("/") if p]
    if any(p in {".", ".."} for p in parts):
        return DEFAULT_ASSET_SUBFOLDER
    # Keep subfolder reasonably short and safe; avoid weird characters.
    safe_parts: list[str] = []
    for p in parts[:6]:
        safe = "".join(ch for ch in p if ch.isalnum() or ch in {"_", "-", "."})
        if safe:
            safe_parts.append(safe[:64])
    return "/".join(safe_parts) or DEFAULT_ASSET_SUBFOLDER


def _get_base_dir(asset_type: str) -> Path:
    asset_type = (asset_type or "input").strip().lower()
    if asset_type not in ALLOWED_ASSET_TYPES:
        asset_type = "input"

    if folder_paths:
        try:
            if asset_type == "output" and hasattr(folder_paths, "get_output_directory"):
                return Path(folder_paths.get_output_directory())
            if hasattr(folder_paths, "get_input_directory"):
                return Path(folder_paths.get_input_directory())
        except Exception:
            pass

    # Fallback: store under extension folder (portable, but not shared by default)
    return Path(__file__).resolve().parent / "ae_assets"


def _guess_ext(filename: str | None, content_type: str | None) -> str:
    ext = ""
    if filename:
        ext = Path(filename).suffix.lower().lstrip(".")

    if not ext and content_type:
        ct = content_type.lower()
        if "png" in ct:
            ext = "png"
        elif "jpeg" in ct or "jpg" in ct:
            ext = "jpg"
        elif "webp" in ct:
            ext = "webp"

    if ext == "jpeg":
        ext = "jpg"
    if ext not in ALLOWED_ASSET_EXTS:
        ext = "png"
    return ext


def get_rembg_session(model_name: str) -> Optional[Any]:
    if not model_name or not new_session:
        return None
    cached = REMBG_SESSION_CACHE.get(model_name)
    if cached:
        return cached
    try:
        session = new_session(model_name)
    except Exception as exc:
        logging.warning(f"[AE] Failed to init rembg session '{model_name}': {exc}")
        return None
    REMBG_SESSION_CACHE[model_name] = session
    return session


# This function will be called by ComfyUI to register routes
def setup_routes(routes):
    """Register custom API routes."""

    @routes.post("/ae_animation/store_asset")
    async def store_asset_handler(request):
        """
        Store an image/mask blob to disk (deduped by sha256) and return a ComfyUI view URL.

        Expects multipart/form-data with:
          - file: uploaded file (required)
          - type: input|output (optional, default: input)
          - subfolder: subfolder under that type (optional, default: ae_animation)
        """
        try:
            post = await request.post()
            file_field = post.get("file")
            if not file_field or not hasattr(file_field, "file"):
                return web.json_response({"error": "Missing file field"}, status=400)

            asset_type = str(post.get("type") or "input").strip().lower()
            if asset_type not in ALLOWED_ASSET_TYPES:
                asset_type = "input"
            subfolder = _safe_rel_subfolder(str(post.get("subfolder") or DEFAULT_ASSET_SUBFOLDER))

            raw = file_field.file.read()
            if not raw:
                return web.json_response({"error": "Empty upload"}, status=400)

            ext = _guess_ext(getattr(file_field, "filename", None), getattr(file_field, "content_type", None))
            digest = hashlib.sha256(raw).hexdigest()
            filename = f"{digest}.{ext}"

            base_dir = _get_base_dir(asset_type)
            asset_dir = (base_dir / subfolder).resolve()
            asset_dir.mkdir(parents=True, exist_ok=True)
            out_path = asset_dir / filename

            # Avoid rewriting if already present
            if not out_path.exists():
                out_path.write_bytes(raw)

            ref = {"type": asset_type, "subfolder": subfolder, "filename": filename}
            url = f"/view?filename={quote(filename)}&subfolder={quote(subfolder)}&type={quote(asset_type)}"
            return web.json_response({"success": True, "ref": ref, "url": url})

        except Exception as e:
            logging.error(f"[AE] Store asset error: {e}", exc_info=True)
            return web.json_response({"error": str(e)}, status=500)
    
    @routes.post("/ae_animation/remove_background")
    async def remove_background_handler(request):
        """Handle remove background request from frontend."""
        try:
            if not REMBG_AVAILABLE:
                return web.json_response({
                    "error": "rembg library not available. Please install it with: pip install rembg"
                }, status=500)
            
            data = await request.json()
            image_data = data.get("image_data", "")
            image_ref = data.get("image_ref") or data.get("ref")
            mode = (data.get("mode") or "").strip()
            
            if not image_data and not image_ref:
                return web.json_response({"error": "No image data provided"}, status=400)

            input_image: Image.Image
            if isinstance(image_data, str) and "," in image_data:
                # Decode base64 image
                b64 = image_data.split(",", 1)[1]
                image_bytes = base64.b64decode(b64)
                input_image = Image.open(python_io.BytesIO(image_bytes)).convert("RGBA")
            elif isinstance(image_ref, dict) and image_ref.get("filename"):
                # Load from ComfyUI-managed file
                asset_type = str(image_ref.get("type") or "input").strip().lower()
                if asset_type not in ALLOWED_ASSET_TYPES:
                    asset_type = "input"
                subfolder = _safe_rel_subfolder(str(image_ref.get("subfolder") or DEFAULT_ASSET_SUBFOLDER))
                filename = os.path.basename(str(image_ref.get("filename")))
                base_dir = _get_base_dir(asset_type)
                img_path = (base_dir / subfolder / filename).resolve()
                input_image = Image.open(img_path).convert("RGBA")
            else:
                return web.json_response({"error": "Unsupported image_data format"}, status=400)
            
            # Convert to numpy array for rembg
            input_array = np.array(input_image)
            
            # Remove background using rembg
            session = get_rembg_session(mode) if mode else None
            output_array = remove(input_array, session=session) if session else remove(input_array)
            
            # Convert back to PIL Image
            output_image = Image.fromarray(output_array)
            
            # Convert to base64
            output_buffer = python_io.BytesIO()
            output_image.save(output_buffer, format="PNG")
            output_base64 = base64.b64encode(output_buffer.getvalue()).decode("utf-8")
            output_data_url = f"data:image/png;base64,{output_base64}"
            
            return web.json_response({
                "success": True,
                "image_data": output_data_url
            })
            
        except Exception as e:
            logging.error(f"[AE] Remove background error: {e}", exc_info=True)
            return web.json_response({
                "error": str(e)
            }, status=500)
