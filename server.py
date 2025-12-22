from aiohttp import web
import base64
import io as python_io
import logging
from typing import Any, Dict, Optional

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
            mode = (data.get("mode") or "").strip()
            
            if not image_data:
                return web.json_response({"error": "No image data provided"}, status=400)
            
            # Decode base64 image
            if "," in image_data:
                image_data = image_data.split(",", 1)[1]
            
            image_bytes = base64.b64decode(image_data)
            input_image = Image.open(python_io.BytesIO(image_bytes)).convert("RGBA")
            
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
