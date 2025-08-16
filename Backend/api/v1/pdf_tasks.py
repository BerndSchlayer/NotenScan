from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, BackgroundTasks
from fastapi.responses import JSONResponse
from sc_base_backend import get_current_user
from sc_base_backend import get_pg_connection
from typing import List
import os
import uuid
import shutil
from config import POPLER_PATH, STATIC_DIR, PAGES_DIR
from sc_base_backend import get_settings
from pdf2image import convert_from_path
from PIL import Image
import cv2
import numpy as np
import logging
from scipy.signal import find_peaks
import datetime
from skimage.measure import label, regionprops


router = APIRouter(prefix="/pdf_tasks", tags=["pdf_tasks"])


class DeskewRequest(BaseModel):
    task_id: str
    page: int
    angle: float


@router.post("/deskew")
async def deskew_page(
    data: DeskewRequest,
    user: dict = Depends(get_current_user)
):
    # Prüfe Rechte: Task muss dem User gehören
    conn = get_pg_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM pdf_tasks WHERE id = %s AND user_id = %s",
                    (data.task_id, int(user.get('user_id'))))
        row = cur.fetchone()
        if not row:
            raise HTTPException(
                status_code=404, detail="Task not found or not allowed")
    # Lade Bild
    page_num_str = str(int(data.page)).zfill(5)
    pages_dir = os.path.join(STATIC_DIR, data.task_id, "pages")
    image_path = os.path.join(
        pages_dir, f"{data.task_id}_page_{page_num_str}.png")
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="Page image not found")
    try:
        image = Image.open(image_path)
        # Rotieren um den gewünschten Winkel
        rotated = image.rotate(-data.angle, expand=True, fillcolor="white")
        rotated.save(image_path, "PNG")
        image.close()
        rotated.close()
        return {"status": "success", "angle": data.angle}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fehler beim Deskew: {e}")


def is_debug_mode():
    import os
    debug = os.environ.get("DEBUG", "False")
    return str(debug).strip().lower() in ("1", "true", "yes", "ja")


def is_debug_process_pdf_image():
    import os

    if is_debug_process_pdf_detailed_image():
        return True

    debug = os.environ.get("DEBUG_PROCESS_PDF_IMAGE", "False")
    return str(debug).strip().lower() in ("1", "true", "yes", "ja")


def is_debug_process_pdf_detailed_image():
    import os
    debug = os.environ.get("DEBUG_PROCESS_PDF_DETAILED_IMAGES", "False")
    return str(debug).strip().lower() in ("1", "true", "yes", "ja")


def deskew_scikit_orientation(image, optpages_dir, page_num, log_debug=None):
    log_debug = getattr(image, '_log_debug', None)
    if log_debug:
        log_debug("")
        log_debug("deskew_scikit_orientation: Start")

    image_cv = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(image_cv, cv2.COLOR_BGR2GRAY)
    thresh = cv2.threshold(
        gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]

    if is_debug_mode():
        log_debug("Kontrollbilder gray und thresh werden gespeichert.")
    if is_debug_process_pdf_detailed_image():
        cv2.imwrite(os.path.join(
            optpages_dir, f"page_{page_num}_4_1_gray.png"), gray)
        cv2.imwrite(os.path.join(
            optpages_dir, f"page_{page_num}_4_2_thresh.png"), thresh)

    labeled = label(thresh)
    regions = regionprops(labeled)

    if not regions:
        if log_debug:
            log_debug("Keine Regionen gefunden, keine Rotation.")
        return 0.0

    largest_region = max(regions, key=lambda r: r.area)
    angle_rad = largest_region.orientation
    angle_deg = -np.degrees(angle_rad)

    if 70 <= abs(angle_deg) <= 110:
        if angle_deg > 0:
            angle_deg = angle_deg - 90
        else:
            angle_deg = angle_deg + 90
        if log_debug:
            log_debug(
                f"Winkel wurde um 90° korrigiert: Neuer Winkel = {angle_deg:.2f}°")

    if is_debug_process_pdf_detailed_image():
        debug_img = image_cv.copy()
        h, w = debug_img.shape[:2]
        center_img = (w // 2, h // 2)
        length = min(h, w) // 2 - 10
        angle_rad_draw = np.radians(angle_deg)
        x2 = int(center_img[0] + length * np.cos(angle_rad_draw))
        y2 = int(center_img[1] - length * np.sin(angle_rad_draw))
        cv2.arrowedLine(debug_img, center_img, (x2, y2),
                        (0, 0, 255), 4, tipLength=0.08)
        cv2.putText(debug_img, f"{angle_deg:.2f}°", (
            center_img[0]+10, center_img[1]-10), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 2)
        cv2.imwrite(os.path.join(
            optpages_dir, f"page_{page_num}_4_3_angle_debug.png"), debug_img)

    return angle_deg


def deskew_min_area_rect(image, optpages_dir, page_num, log_debug=None):
    log_debug = getattr(image, '_log_debug', None)
    if log_debug:
        log_debug("")
        log_debug("deskew_min_area_rect: Wird aufgerufen")
    import cv2
    import numpy as np
    from PIL import Image
    image_cv = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    h, w = image_cv.shape[:2]
    gray = cv2.cvtColor(image_cv, cv2.COLOR_BGR2GRAY)
    thresh = cv2.threshold(
        gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thresh > 0))
    if is_debug_process_pdf_detailed_image():
        cv2.imwrite(os.path.join(
            optpages_dir, f"page_{page_num}_03_01_gray.png"), gray)
        cv2.imwrite(os.path.join(
            optpages_dir, f"page_{page_num}_03_02_thresh.png"), thresh)
    if coords.shape[0] == 0:
        if log_debug:
            log_debug("Keine relevanten Pixel gefunden, keine Rotation.")
        return 0.0
    rect = cv2.minAreaRect(coords)
    (center, (width, height), angle) = rect

    if image_cv.shape[1] > image_cv.shape[0]:
        if log_debug:
            log_debug("Bild ist im Landscape-Modus.")
        if width > height and 80 <= angle <= 100:
            angle = angle - 90.0
            if log_debug:
                log_debug(f"Winkel wurde auf {angle} gekippt.")
        if width < height:
            width, height = height, width
            center = (center[1], center[0])
            if log_debug:
                log_debug(f"Breite und Höhe wurden vertauscht")
    else:
        if log_debug:
            log_debug("Bild ist im Portrait-Modus.")
        if width < height and 80 <= angle <= 100:
            angle = angle - 90.0
            if log_debug:
                log_debug(f"Winkel wurde auf {angle} gekippt.")
        if width > height:
            width, height = height, width
            center = (center[1], center[0])
            if log_debug:
                log_debug(f"Breite und Höhe wurden vertauscht")

    angle = -angle

    if is_debug_process_pdf_detailed_image():
        debug_img = image_cv.copy()
        h, w = debug_img.shape[:2]
        box = cv2.boxPoints(((center[0], center[1]), (width, height), angle))
        box = np.int0(box)
        min_x, min_y = box[:, 0].min(), box[:, 1].min()
        offset_x = 0
        offset_y = 0
        if min_x < 0:
            offset_x = -min_x
        if min_y < 0:
            offset_y = -min_y
        box[:, 0] += offset_x
        box[:, 1] += offset_y
        box[:, 1] = h - box[:, 1]
        box[:, 0] = np.clip(box[:, 0], 0, w - 1)
        box[:, 1] = np.clip(box[:, 1], 0, h - 1)
        cv2.drawContours(debug_img, [box], 0, (0, 0, 255), 2)
        cv2.imwrite(os.path.join(
            optpages_dir, f"page_{page_num}_03_03_rect.png"), debug_img)

    return angle


def create_pdf_task(conn, user_id, filename):
    task_id = str(uuid.uuid4())
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO pdf_tasks (id, user_id, filename, status, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
            (task_id, user_id, filename, 'pending',
             datetime.datetime.now(), datetime.datetime. now())
        )
        conn.commit()
    return task_id


def update_pdf_task_status(conn, task_id, status, num_pages=None, error_message=None):
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE pdf_tasks SET status=%s, updated_at=%s, num_pages=%s, error_message=%s WHERE id=%s""",
            (status, datetime.datetime.now(), num_pages, error_message, task_id)
        )
        conn.commit()


def process_pdf_task(task_id, pdf_path, pages_dir, conn):

    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    log_dir = os.path.join(STATIC_DIR, task_id, "debug_logs")
    optpages_dir = os.path.join(STATIC_DIR, task_id, "opt_pages")
    log_path = os.path.join(log_dir, f"process_pdf_task_{timestamp}.log")

    if is_debug_mode():
        os.makedirs(log_dir, exist_ok=True)

        def log_debug(msg):
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(f"[{datetime.datetime.now().isoformat()}] {msg}\n")
        log_debug(
            f"Start process_pdf_task: task_id={task_id}, pdf_path={pdf_path}, pages_dir={pages_dir}")

    if is_debug_process_pdf_image():
        os.makedirs(optpages_dir, exist_ok=True)

    try:
        images = convert_from_path(pdf_path, poppler_path=POPLER_PATH)
        if is_debug_mode():
            log_debug(f"PDF converted to {len(images)} images.")

        for i, img in enumerate(images):
            if is_debug_mode():
                log_debug(
                    f"------------------ Processing page {i+1} --------------------")
            page_num_str = str(i+1).zfill(5)

            if is_debug_process_pdf_image():
                img_cv = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
                cv2.imwrite(os.path.join(
                    optpages_dir, f"page_{page_num_str}_0_origin.png"), img_cv)

            if is_debug_mode():
                setattr(img, '_log_debug', log_debug)
            angle_min_area = deskew_min_area_rect(
                img, optpages_dir, page_num_str)
            if is_debug_mode():
                log_debug(f"deskew_min_area_rect: Winkel = {angle_min_area}°")
            angle_scikit = deskew_scikit_orientation(
                img, optpages_dir, page_num_str)
            if is_debug_mode():
                log_debug(
                    f"deskew_scikit_orientation: Winkel = {angle_scikit}°")

            angle_diff = abs(angle_min_area - angle_scikit)
            if is_debug_mode():
                log_debug("")
                log_debug(f"Winkel-Differenz: {angle_diff:.2f}°")

            angle_to_apply = 0.0
            if angle_diff <= 0.6:
                angle_to_apply = (angle_min_area + angle_scikit) / 2.0
                if is_debug_mode():
                    log_debug(
                        f"Winkel sind ähnlich, Mittelwert wird verwendet {angle_to_apply}°")
            else:
                if angle_diff >= 1.5:
                    angle_to_apply = angle_scikit
                    if is_debug_mode():
                        log_debug(
                            f"Winkel weichen um > 1.5 ab, deshalb wird Winkel scikit verwendet {angle_to_apply}°")
                else:
                    if is_debug_mode():
                        log_debug(
                            "Winkel weichen zu stark ab, deshalb auf 0.0° gesetzt")

            if angle_to_apply != 0.0 and abs(angle_to_apply) < 20:
                if is_debug_mode():
                    log_debug(
                        f"Rotation wird durchgeführt mit Mittelwert: {angle_to_apply:.2f}°")
                img_cv = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
                h, w = img_cv.shape[:2]
                center_img = (w // 2, h // 2)
                M = cv2.getRotationMatrix2D(center_img, angle_to_apply, 1.0)
                rotated = cv2.warpAffine(
                    img_cv, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
                img = Image.fromarray(cv2.cvtColor(rotated, cv2.COLOR_BGR2RGB))
                if is_debug_process_pdf_image():
                    cv2.imwrite(os.path.join(
                        optpages_dir, f"page_{page_num_str}_5_rotated.png"), rotated)
            else:
                if log_debug:
                    log_debug(
                        f"Winkel {angle_to_apply}° > 20° keine Rotation.")

            img.save(os.path.join(
                pages_dir, f"{task_id}_page_{page_num_str}.png"), "PNG")

            if is_debug_mode():
                log_debug(
                    f"Page {i+1} saved as {task_id}_page_{page_num_str}.png")

            img.close()
            del img
        update_pdf_task_status(conn, task_id, "done", num_pages=len(images))
        if is_debug_mode():
            log_debug("PDF task finished successfully.")
    except Exception as e:
        if is_debug_mode():
            log_debug(f"Exception: {str(e)}")
        logging.exception("Exception in process_pdf_task")
        update_pdf_task_status(conn, task_id, "error", error_message=str(e))


@router.post("/upload")
async def upload_pdf(
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None,
    user: dict = Depends(get_current_user)
):
    conn = get_pg_connection()
    filename = file.filename
    task_id = create_pdf_task(conn, user.get('user_id'), filename)
    task_dir = os.path.join(STATIC_DIR, task_id)
    pages_dir = os.path.join(task_dir, "pages")
    os.makedirs(pages_dir, exist_ok=True)
    pdf_path = os.path.join(task_dir, "original.pdf")
    with open(pdf_path, "wb") as f:
        f.write(await file.read())
    update_pdf_task_status(conn, task_id, "processing")
    background_tasks.add_task(
        process_pdf_task, task_id, pdf_path, pages_dir, conn)
    return {"id": task_id, "task_id": task_id, "status": "processing"}


@router.get("/status/{task_id}")
async def get_pdf_task_status(task_id: str, user: dict = Depends(get_current_user)):
    conn = get_pg_connection()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT status, num_pages, error_message FROM pdf_tasks WHERE id=%s", (task_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    try:
        return {"status": row["status"], "num_pages": row["num_pages"], "error_message": row["error_message"]}
    except (TypeError, KeyError):
        return {"status": row[0], "num_pages": row[1], "error_message": row[2]}


@router.get("/pages/{task_id}")
async def get_pages(task_id: str, user: dict = Depends(get_current_user)):
    pages_dir = os.path.join(STATIC_DIR, task_id, "pages")
    if not os.path.isdir(pages_dir):
        return JSONResponse(content={"pages": []})
    files = sorted(f for f in os.listdir(pages_dir)
                   if f.startswith(f"{task_id}_") and f.endswith(".png"))
    base_url = get_settings().frontend_url or os.getenv(
        "SERVER_URL", "http://localhost:8000")
    urls = [f"{base_url}/static/{task_id}/pages/{f}" for f in files]
    return JSONResponse(content={"pages": urls})


@router.get("/", response_model=List[dict])
def list_pdf_tasks(user: dict = Depends(get_current_user)):
    conn = get_pg_connection()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, filename, status, num_pages, created_at, updated_at, error_message
            FROM pdf_tasks
            WHERE user_id = %s
            ORDER BY created_at DESC
            """,
            (int(user.get('user_id')),)
        )
        rows = cur.fetchall()
        tasks = []
        for row in rows:
            task = dict(row)
            for date_field in ("created_at", "updated_at"):
                if date_field in task and hasattr(task[date_field], "isoformat"):
                    task[date_field] = task[date_field].isoformat()
            tasks.append(task)
    return tasks


@router.get("/{task_id}")
def get_pdf_task(task_id: str, user: dict = Depends(get_current_user)):
    conn = get_pg_connection()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, filename, status, num_pages, created_at, updated_at, error_message
            FROM pdf_tasks
            WHERE id = %s AND user_id = %s
            """,
            (task_id, int(user.get('user_id')))
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Task not found")
        columns = [desc[0] for desc in cur.description]
        task = dict(zip(columns, row))
        for date_field in ("created_at", "updated_at"):
            if date_field in task and hasattr(task[date_field], "isoformat"):
                task[date_field] = task[date_field].isoformat()
        return task


@router.delete("/{task_id}")
def delete_pdf_task(task_id: str, user: dict = Depends(get_current_user)):
    conn = get_pg_connection()
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM pdf_tasks WHERE id = %s AND user_id = %s",
            (task_id, int(user.get('user_id')))
        )
        if cur.rowcount == 0:
            raise HTTPException(
                status_code=404, detail="Task not found or not allowed")
        conn.commit()
    task_dir = os.path.join(STATIC_DIR, task_id)
    import traceback
    try:
        shutil.rmtree(task_dir)
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"[ERROR] Fehler beim Löschen von {task_dir}: {e}")
        traceback.print_exc()
    return {"detail": "Task deleted"}
