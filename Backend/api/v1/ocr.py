from fastapi import APIRouter, Depends, Query, HTTPException, Body
from typing import List, Optional
from pydantic import BaseModel
from config import TESSERACT_CMD, VOICES_EXPORT_DIR, STATIC_DIR
import zipfile
from xml.etree.ElementTree import Element, SubElement, tostring
from pytesseract import Output
import json
import os
import numpy as np
import pytesseract
from PIL import Image
from sc_base_backend import get_current_user


def calculate_suggestions(boxes, width):
    suggestions = {}
    if not boxes or not width:
        return suggestions
    box_candidates = []
    for b in boxes:
        avg_height = b["height"] if "height" in b else 0
        box_candidates.append({
            "text": b["text"],
            "x": b["x"],
            "y": b["y"],
            "width": b["width"],
            "height": b["height"],
            "avg_height": avg_height
        })
    if box_candidates:
        suggestions["Stimme"] = min(
            box_candidates, key=lambda b: b["x"])['text']
        suggestions["Komponist"] = max(
            box_candidates, key=lambda b: b["x"] + b["width"])['text']
        tolerance = 0.2 * width
        centered = [b for b in box_candidates if abs(
            (b["x"] + b["width"]/2) - width/2) <= tolerance]
        if centered:
            titel_box = max(centered, key=lambda b: b["avg_height"])
            suggestions["Titel"] = titel_box['text']
        else:
            titel_box = max(box_candidates, key=lambda b: b["avg_height"])
            suggestions["Titel"] = titel_box['text']
        genre_candidates = [
            b for b in box_candidates
            if (
                (b["y"] > titel_box["y"] + titel_box["height"] and abs(b["x"] - titel_box["x"]) <= 0.2 * width) or
                (b["x"] > titel_box["x"] + titel_box["width"] and b["y"] >= titel_box["y"]
                 and (b["y"] + b["height"]) <= (titel_box["y"] + titel_box["height"]))
            )
        ]
        if genre_candidates:
            suggestions["Genre"] = min(
                genre_candidates, key=lambda b: b["x"])['text']
        else:
            suggestions["Genre"] = "Unbekannt"
    return suggestions


pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD
router = APIRouter(prefix="/ocr")


class ExtractTextBox(BaseModel):
    x: int
    y: int
    width: int
    height: int


class ExtractTextRequest(BaseModel):
    task_id: str
    page: int
    boxes: List[ExtractTextBox]


class ExtractTextResponseBox(BaseModel):
    x: int
    y: int
    width: int
    height: int
    text: str


@router.post("/extract_text/")
async def extract_text_for_boxes(
    data: ExtractTextRequest,
    user: dict = Depends(get_current_user)
):
    page_num_str = str(data.page).zfill(5)
    image_path = os.path.join(STATIC_DIR, data.task_id,
                              "pages", f"{data.task_id}_page_{page_num_str}.png")
    if not os.path.exists(image_path):
        raise HTTPException(
            status_code=404, detail=f"Seite {data.page} für Task {data.task_id} nicht gefunden")
    try:
        image = Image.open(image_path)
        try:
            task_id = data.task_id
            stored_boxes = load_boxes(task_id)
            all_boxes = stored_boxes.get("template", {}).get("boxes", [])
            results = []
            for box in data.boxes:
                left = int(box.x)
                upper = int(box.y)
                right = int(box.x + box.width)
                lower = int(box.y + box.height)
                cropped = image.crop((left, upper, right, lower))
                text = pytesseract.image_to_string(
                    cropped, lang="deu", config="--psm 6").strip()
                results.append({
                    "x": box.x,
                    "y": box.y,
                    "width": box.width,
                    "height": box.height,
                    "text": text
                })
            for i, box in enumerate(all_boxes):
                for res in results:
                    if (
                        int(box["x"]) == int(res["x"]) and
                        int(box["y"]) == int(res["y"]) and
                        int(box["width"]) == int(res["width"]) and
                        int(box["height"]) == int(res["height"])
                    ):
                        box["text"] = res["text"]
            width = image.width
            suggestions = calculate_suggestions(all_boxes, width)
            stored_boxes["template"] = {
                "boxes": all_boxes, "suggestions": suggestions}
            save_boxes(task_id, stored_boxes)
            return {"boxes": results, "suggestions": suggestions}
        finally:
            image.close()
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Fehler bei der Texterkennung: {e}")


def get_boxes_path(task_id):
    return os.path.join(STATIC_DIR, task_id, "boxes.json")


def load_boxes(task_id):
    path = get_boxes_path(task_id)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_boxes(task_id, data):
    import traceback
    path = get_boxes_path(task_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except PermissionError as e:
        print(
            f"[PermissionError] Zugriff verweigert beim Schreiben von {path}:")
        print(traceback.format_exc())
        raise
    except Exception as e:
        print(f"[save_boxes] Fehler beim Schreiben von {path}:")
        print(traceback.format_exc())
        raise


class SaveBoxesRequest(BaseModel):
    task_id: str
    boxes: list
    suggestions: dict = {}
    labels: dict = {}


@router.put("/boxes/")
async def save_ocr_boxes(
    data: SaveBoxesRequest,
    user: dict = Depends(get_current_user)
):
    task_id = data.task_id
    stored_boxes = load_boxes(task_id)
    stored_boxes["template"] = {
        "boxes": data.boxes,
        "suggestions": data.suggestions,
        "labels": data.labels if hasattr(data, "labels") else {}
    }
    save_boxes(task_id, stored_boxes)
    return {"status": "success"}


@router.get("/")
async def get_ocr_boxes(
    task_id: str = Query(...),
    page: int = Query(...),
    trigger_ocr: bool = Query(False),
    user: dict = Depends(get_current_user)
):

    page_num_str = str(page).zfill(5)
    image_path = os.path.join(
        STATIC_DIR, task_id, "pages", f"{task_id}_page_{page_num_str}.png")
    stored_boxes = load_boxes(task_id)
    if not trigger_ocr:
        if "template" in stored_boxes:
            template = stored_boxes["template"]
            return {
                "boxes": template.get("boxes", []),
                "suggestions": template.get("suggestions", {}),
                "labels": template.get("labels", {})
            }
        if not os.path.exists(image_path):
            raise HTTPException(
                status_code=404, detail=f"Seite {page} für Task {task_id} nicht gefunden")
        return {"message": "No stored boxes", "boxes": [], "suggestions": {}, "labels": {}}

    image = Image.open(image_path)
    try:
        img_arr = np.array(image)
        data = pytesseract.image_to_data(
            img_arr,
            lang="deu",
            config="--psm 6",
            output_type=Output.DICT
        )

        height, width = img_arr.shape[:2]
        cutoff_y = 0.25 * height
        min_confidence = 70

        boxes = []
        n_boxes = len(data["level"])
        groups = {}
        for i in range(n_boxes):
            conf = data["conf"][i]
            try:
                conf = int(conf)
            except:
                conf = -1
            x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
            if y > cutoff_y or conf < min_confidence:
                continue
            if not data["text"][i].strip():
                continue
            key = (data["block_num"][i], data["par_num"]
                   [i], data["line_num"][i])
            groups.setdefault(key, []).append(i)

        for key, indices in groups.items():
            sorted_indices = sorted(indices, key=lambda i: data["left"][i])
            subgroups = []
            current_group = []
            distance_threshold = 40
            for idx in sorted_indices:
                if not current_group:
                    current_group.append(idx)
                else:
                    prev = current_group[-1]
                    gap = data["left"][idx] - \
                        (data["left"][prev] + data["width"][prev])
                    avg_word_width = sum(
                        data["width"][j] for j in sorted_indices) / len(sorted_indices)
                    dynamic_threshold = max(
                        distance_threshold, 1.5 * avg_word_width)
                    ref_h = data["height"][current_group[0]]
                    height_diff = abs(data["height"][idx] - ref_h)
                    if gap > dynamic_threshold or (height_diff / ref_h > 0.3):
                        subgroups.append(current_group)
                        current_group = [idx]
                    else:
                        current_group.append(idx)
            if current_group:
                subgroups.append(current_group)
            for subgroup in subgroups:
                words = [data["text"][i].strip()
                         for i in subgroup if data["text"][i].strip()]
                if not words:
                    continue
                block_text = " ".join(words)
                lefts = [data["left"][i] for i in subgroup]
                tops = [data["top"][i] for i in subgroup]
                rights = [data["left"][i] + data["width"][i] for i in subgroup]
                bottoms = [data["top"][i] + data["height"][i]
                           for i in subgroup]
                grp_left = min(lefts)
                grp_top = min(tops)
                grp_right = max(rights)
                grp_bottom = max(bottoms)
                grp_width = grp_right - grp_left
                grp_height = grp_bottom - grp_top
                boxes.append({
                    "x": grp_left,
                    "y": grp_top,
                    "width": grp_width,
                    "height": grp_height,
                    "text": block_text,
                    "selected": False
                })
        suggestions = calculate_suggestions(boxes, width)
        labels = stored_boxes.get("template", {}).get("labels", {})
        stored_boxes["template"] = {"boxes": boxes,
                                    "suggestions": suggestions, "labels": labels}
        save_boxes(task_id, stored_boxes)

        return {"boxes": boxes, "suggestions": suggestions, "labels": labels}
    finally:
        image.close()


@router.post("/voices")
def detect_voices(
    task_id: str = Body(...),
    title_box: dict = Body(...),
    voice_box: dict = Body(...),
    user: dict = Depends(get_current_user)
):
    pages_dir = os.path.join(STATIC_DIR, task_id, "pages")
    files = []
    if os.path.isdir(pages_dir):
        files = sorted(f for f in os.listdir(pages_dir) if f.endswith(".png"))
    results = []
    for idx, fname in enumerate(files):
        img_path = os.path.join(pages_dir, fname)
        img = Image.open(img_path)
        try:
            img_width, img_height = img.size

            tx = max(0, title_box["x"] - 0.1 * title_box["width"])
            ty = max(0, title_box["y"] - 0.1 * title_box["height"])
            tw = title_box["width"] * 1.2
            th = title_box["height"] * 1.2
            t_right = min(img_width, tx + tw)
            t_bottom = min(img_height, ty + th)
            title_region = img.crop((tx, ty, t_right, t_bottom))
            title_text = pytesseract.image_to_string(
                title_region, lang="deu").strip()

            vx = max(0, voice_box["x"] - 0.3 * voice_box["width"])
            vy = max(0, voice_box["y"] - 0.3 * voice_box["height"])
            vw = voice_box["width"] * 1.6
            vh = voice_box["height"] * 1.6
            min_voice_width = 0.3 * img_width
            if vw < min_voice_width:
                vw = min_voice_width
            v_right = min(img_width, vx + vw)
            v_bottom = min(img_height, vy + vh)
            voice_region = img.crop((vx, vy, v_right, v_bottom))
            voice_text = pytesseract.image_to_string(
                voice_region, lang="deu").strip()

            results.append({
                "page": idx + 1,
                "title": title_text,
                "voice": voice_text
            })
        finally:
            img.close()

    voice_indices = [
        i for i, v in enumerate(results)
        if v["voice"].strip() != ""
    ]
    for i, v in enumerate(results):
        v["num_pages"] = 0

    for idx, start_idx in enumerate(voice_indices):
        end_idx = voice_indices[idx + 1] if idx + \
            1 < len(voice_indices) else len(results)
        num_pages = end_idx - start_idx
        results[start_idx]["num_pages"] = num_pages

    voices_with_pages = [
        {
            "page": v["page"],
            "title": v["title"],
            "voice": v["voice"],
            "num_pages": v["num_pages"]
        }
        for v in results if v["voice"].strip() != ""
    ]
    return {"voices": voices_with_pages}


class VoiceEntry(BaseModel):
    page: int
    voice: str


class SplitVoicesRequest(BaseModel):
    voices: List[VoiceEntry]
    title: str
    genre: Optional[str] = ""
    komponist: Optional[str] = ""
    arrangeur: Optional[str] = ""
    start_page: Optional[int] = None
    end_page: Optional[int] = None


@router.post("/voices/split")
def split_voices(
    task_id: str = Body(...),
    data: SplitVoicesRequest = Body(...),
    user: dict = Depends(get_current_user)
):
    voices = data.voices
    title = data.title
    genre = data.genre
    komponist = data.komponist
    arrangeur = data.arrangeur
    start_page = data.start_page
    end_page = data.end_page
    from pdf2image import convert_from_path
    from PIL import Image

    export_dir = VOICES_EXPORT_DIR
    os.makedirs(export_dir, exist_ok=True)

    pages_dir = os.path.join(STATIC_DIR, task_id, "pages")
    files = []
    if os.path.isdir(pages_dir):
        files = sorted(f for f in os.listdir(pages_dir) if f.endswith(".png"))
    pages = []
    for f in files:
        img = Image.open(os.path.join(pages_dir, f))
        pages.append(img)

    voice_starts = []
    for v in voices:
        try:
            page_index = int(v["page"]) - 1
            voice_text = v["voice"].strip()
            if voice_text:
                voice_starts.append((page_index, voice_text))
        except Exception:
            continue
    voice_starts.sort(key=lambda x: x[0])

    voices_ranges = []
    if start_page is not None and end_page is not None and len(voice_starts) == 1:
        voices_ranges.append(
            (start_page - 1, end_page - 1, voice_starts[0][1]))
    else:
        for i, (start_page_idx, voice_text) in enumerate(voice_starts):
            if len(voice_starts) == 1:
                end_page_idx = len(pages) - 1
            else:
                end_page_idx = voice_starts[i+1][0] - 1 if i + \
                    1 < len(voice_starts) else len(pages) - 1
            voices_ranges.append((start_page_idx, end_page_idx, voice_text))

    pdf_files = []
    for (start, end, voice_text) in voices_ranges:
        voice_filename_part = voice_text.replace(".", "")
        filename = f"{title} - {voice_filename_part}.pdf"
        output_path = os.path.join(export_dir, filename)
        selected_pages = pages[start:end+1]
        if selected_pages:
            pages_rgb = [p.convert("RGB") for p in selected_pages]
            try:
                pages_rgb[0].save(output_path, "PDF", resolution=100.0,
                                  save_all=True, append_images=pages_rgb[1:])
                pdf_files.append(filename)
            finally:
                for p in selected_pages:
                    p.close()

    if len(voices) > 1:
        root_elem = Element("NotenIndex")
        stueck_elem = SubElement(root_elem, "Stueck")
        for key, value in [("Titel", title), ("Genre", genre), ("Komponist", komponist), ("Arrangeur", arrangeur)]:
            sub_elem = SubElement(stueck_elem, key)
            sub_elem.text = value
        stimmen_container = SubElement(root_elem, "Stimmen")
        for (start, end, voice_text) in voices_ranges:
            voice_filename_part = voice_text.replace(".", "")
            filename = f"{title} - {voice_filename_part}.pdf"
            stimme_elem = SubElement(stimmen_container, "Stimme")
            designation_elem = SubElement(stimme_elem, "Stimmenbezeichnung")
            designation_elem.text = voice_text
            file_elem = SubElement(stimme_elem, "Dateiname")
            file_elem.text = filename
            start_elem = SubElement(stimme_elem, "StartSeite")
            start_elem.text = str(start + 1)
            end_elem = SubElement(stimme_elem, "EndSeite")
            end_elem.text = str(end + 1)

        def indent(elem, level=0):
            i = "\n" + level * "  "
            if len(elem):
                if not elem.text or not elem.text.strip():
                    elem.text = i + "  "
                for child in elem:
                    indent(child, level + 1)
                if not child.tail or not child.tail.strip():
                    child.tail = i
            else:
                if level and (not elem.tail or not elem.tail.strip()):
                    elem.tail = i
        indent(root_elem)
        xml_str = tostring(root_elem, encoding="unicode")
        xml_output_path = os.path.join(export_dir, "NotenIndex.xml")
        with open(xml_output_path, "w", encoding="utf-8") as f:
            f.write(xml_str)

    return {
        "status": "success",
        "pdf_files": pdf_files,
        "export_dir": export_dir
    }


@router.post("/voices/split_zip")
def split_voices_zip(
    task_id: str = Body(...),
    voices: list = Body(...),
    title: str = Body(...),
    genre: str = Body(default=""),
    komponist: str = Body(default=""),
    arrangeur: str = Body(default=""),
    user: dict = Depends(get_current_user)
):
    from pdf2image import convert_from_path
    from PIL import Image

    export_dir = VOICES_EXPORT_DIR
    os.makedirs(export_dir, exist_ok=True)

    pages_dir = os.path.join(STATIC_DIR, task_id, "pages")
    files = []
    if os.path.isdir(pages_dir):
        files = sorted(f for f in os.listdir(pages_dir) if f.endswith(".png"))
    pages = []
    for f in files:
        img = Image.open(os.path.join(pages_dir, f))
        pages.append(img)

    voice_starts = []
    for v in voices:
        try:
            page_index = int(v["page"]) - 1
            voice_text = v["voice"].strip()
            if voice_text:
                voice_starts.append((page_index, voice_text))
        except Exception:
            continue
    voice_starts.sort(key=lambda x: x[0])

    voices_ranges = []
    for i, (start_page, voice_text) in enumerate(voice_starts):
        if len(voice_starts) == 1:
            end_page = len(pages) - 1
        else:
            end_page = voice_starts[i+1][0] - 1 if i + \
                1 < len(voice_starts) else len(pages) - 1
        voices_ranges.append((start_page, end_page, voice_text))

    pdf_files = []
    for (start, end, voice_text) in voices_ranges:
        voice_filename_part = voice_text.replace(".", "")
        filename = f"{title} - {voice_filename_part}.pdf"
        output_path = os.path.join(export_dir, filename)
        selected_pages = pages[start:end+1]
        if selected_pages:
            pages_rgb = [p.convert("RGB") for p in selected_pages]
            try:
                pages_rgb[0].save(output_path, "PDF", resolution=100.0,
                                  save_all=True, append_images=pages_rgb[1:])
                pdf_files.append(filename)
            finally:
                for p in selected_pages:
                    p.close()

    root_elem = Element("NotenIndex")
    stueck_elem = SubElement(root_elem, "Stueck")
    for key, value in [("Titel", title), ("Genre", genre), ("Komponist", komponist), ("Arrangeur", arrangeur)]:
        sub_elem = SubElement(stueck_elem, key)
        sub_elem.text = value
    stimmen_container = SubElement(root_elem, "Stimmen")
    for (start, end, voice_text) in voices_ranges:
        voice_filename_part = voice_text.replace(".", "")
        filename = f"{title} - {voice_filename_part}.pdf"
        stimme_elem = SubElement(stimmen_container, "Stimme")
        designation_elem = SubElement(stimme_elem, "Stimmenbezeichnung")
        designation_elem.text = voice_text
        file_elem = SubElement(stimme_elem, "Dateiname")
        file_elem.text = filename
        start_elem = SubElement(stimme_elem, "StartSeite")
        start_elem.text = str(start + 1)
        end_elem = SubElement(stimme_elem, "EndSeite")
        end_elem.text = str(end + 1)

    def indent(elem, level=0):
        i = "\n" + level * "  "
        if len(elem):
            if not elem.text or not elem.text.strip():
                elem.text = i + "  "
            for child in elem:
                indent(child, level + 1)
            if not child.tail or not child.tail.strip():
                child.tail = i
        else:
            if level and (not elem.tail or not elem.tail.strip()):
                elem.tail = i
    indent(root_elem)
    xml_str = tostring(root_elem, encoding="unicode")
    xml_output_path = os.path.join(export_dir, "NotenIndex.xml")
    with open(xml_output_path, "w", encoding="utf-8") as f:
        f.write(xml_str)

    if not os.path.exists(xml_output_path):
        raise HTTPException(
            status_code=500, detail="ZIP-Datei konnte nicht erstellt werden.")

    from urllib.parse import quote
    zip_filename = f"{title}.zip" if title else "stimmen_export.zip"
    zip_filename_safe = zip_filename.replace(" ", "_").replace("/", "_")
    zip_path = os.path.join(export_dir, zip_filename_safe)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for pdf in pdf_files:
            pdf_path = os.path.join(export_dir, pdf)
            zipf.write(pdf_path, arcname=pdf)
        zipf.write(xml_output_path, arcname="NotenIndex.xml")

    if not os.path.exists(zip_path):
        raise HTTPException(
            status_code=500, detail="ZIP-Datei konnte nicht erstellt werden.")

    zip_url = f"/static/voices_export/{quote(zip_filename_safe)}"
    return {"zip_url": zip_url}
