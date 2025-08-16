from api.v1 import musicsheets, voices, pdf_tasks
from sc_base_backend.api.v1 import (
    users_router as base_users_router,
    organisations_router as base_organisations_router,
    user_profile_images_router as base_user_profile_images_router,
)
from config import STATIC_DIR, POPLER_PATH, PAGES_DIR
import os
from fastapi.staticfiles import StaticFiles
from api.v1.ocr import router as ocr_router
from dotenv import load_dotenv
from sc_base_backend import get_settings, configure_logging, create_app, get_pg_connection, create_oauth_router
from sc_base_backend.api.info import router as base_info_router
from sc_base_backend.api.v1 import lookup_user_by_email

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
app.include_router(musicsheets.router, prefix=api_prefix)
app.include_router(voices.router, prefix=api_prefix)
app.include_router(pdf_tasks.router, prefix=api_prefix)


# Basis-OAuth- und PDF-Tasks-Router nur mit Präfix einbinden

# Optional: Basis-Info-Router unter API-Präfix bereitstellen
try:
    
except Exception:
    pass

# Static-Verzeichnis erstellen in dem die generierten PDFs gespeichert werden
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
