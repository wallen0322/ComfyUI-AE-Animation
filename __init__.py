from .ae_animation_core import AEAnimationExtension, comfy_entrypoint

# 前端静态文件目录：使用 ./js（与大多数扩展保持一致）
WEB_DIRECTORY = "./js"

# Register routes from server.py
try:
    from server import PromptServer
    from . import server as ae_server
    if hasattr(ae_server, 'setup_routes'):
        ae_server.setup_routes(PromptServer.instance.routes)
except Exception as e:
    import logging
    logging.warning(f"[AE] Failed to register routes: {e}")

__all__ = [
    "comfy_entrypoint",
    "AEAnimationExtension",
    "WEB_DIRECTORY",
]
