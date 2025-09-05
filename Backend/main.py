from sc_base_backend.api.v1 import (
    users_router as base_users_router,
    organisations_router as base_organisations_router,
    user_profile_images_router as base_user_profile_images_router,
)

from dotenv import load_dotenv
from sc_base_backend import get_settings, configure_logging, create_app, create_oauth_router
from sc_base_backend.api.info import router as base_info_router
import os
from fastapi.staticfiles import StaticFiles
from config import STATIC_DIR
from api.v1.ocr import router as ocr_router
from api.v1.musicsheets import router as musicsheets_router
from api.v1.voices import router as voices_router
from api.v1.pdf_tasks import router as pdf_tasks_router
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

# SC_BaseBackend: Settings & Logging
settings = get_settings()
configure_logging(settings.log_level)

# SC_BaseBackend: FastAPI App (inkl. CORS über SCBB_CORS_ORIGINS)
app = create_app()

# API-Präfix aus Basis-Settings (z. B. /api/v1)
api_prefix = f"{settings.api_prefix}/{settings.api_version}".rstrip("/")

# Basis-OAuth-Router mit zentralem User-Lookup aus SC_BaseBackend
app.include_router(base_info_router, prefix=api_prefix)
app.include_router(base_users_router, prefix=api_prefix)
app.include_router(base_user_profile_images_router, prefix=api_prefix)
app.include_router(base_organisations_router, prefix=api_prefix)
app.include_router(create_oauth_router(), prefix=api_prefix)

# eigene Router nur mit API-Präfix inkludieren
app.include_router(ocr_router, prefix=api_prefix)
app.include_router(musicsheets_router, prefix=api_prefix)
app.include_router(voices_router, prefix=api_prefix)
app.include_router(pdf_tasks_router, prefix=api_prefix)

# Static-Verzeichnis erstellen in dem die generierten PDFs gespeichert werden
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Zusätzliche (defensive) CORS-Absicherung für Dev:
# Falls die globale CORS-Konfiguration nicht gegriffen hat, hier noch einmal sicherstellen.
origins = settings.cors_origins or []
if not origins:
    fe = os.getenv("FRONTEND_URL")
    if fe:
        origins = [fe]
if origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
