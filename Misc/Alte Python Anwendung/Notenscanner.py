import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from pdf2image import convert_from_path
from PIL import Image, ImageTk, ImageOps
import pytesseract
from pytesseract import Output

# Neu: Import für OpenCV, NumPy, difflib, os und XML-Erzeugung
import cv2
import numpy as np
import difflib
import os
from xml.etree.ElementTree import Element, SubElement, tostring

# Setze den Pfad zu Tesseract-OCR (anpassen, falls nötig)
pytesseract.pytesseract.tesseract_cmd = r"C:\Python\Tesseract-OCR\tesseract.exe"
# (Optional) Falls Poppler nicht im Systempfad liegt, den Pfad hier anpassen:
poppler_path = r"C:\Python\poppler-24.08.0\Library\bin"

# Neue Funktion zur Vorverarbeitung des OCR-Texts
def preprocess_text(text):
    text = text.strip()
    # Entferne bekannte fehlerhafte Tokens und Sonderzeichen:
    text = text.replace(">>", "")
    text = text.replace("vo.", "")
    # Normalisiere mehrfache Leerzeichen
    text = " ".join(text.split())
    return text

# Funktion zum Formatieren (Einrücken) der XML-Ausgabe
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

# ----------------------- Funktion: deskew mit OpenCV -----------------------
def deskew(image):
    image_cv = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(image_cv, cv2.COLOR_BGR2GRAY)
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thresh > 0))
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    (h, w) = image_cv.shape[:2]
    center = (w // 2, h // 2)
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(image_cv, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return Image.fromarray(cv2.cvtColor(rotated, cv2.COLOR_BGR2RGB))

# ----------------------- Funktion: normalize_margins -----------------------
def normalize_margins(image, margin=10):
    gray = image.convert("L")
    bw = gray.point(lambda x: 0 if x > 200 else 255, mode="1")
    bbox = bw.getbbox()
    if bbox:
        cropped = image.crop(bbox)
        normalized = ImageOps.expand(cropped, border=margin, fill="white")
        return normalized
    return image

# Globale Variablen
pdf_images = []
current_page = 0
ocr_results = {}          # OCR-Ergebnisse pro Seite
static_ocr_options = {}   # OCR-Ergebnisse der aktuellen Seite
global_user_info = {}     # Benutzereinstellungen (Titel, Genre, etc.)
info_data = {}            # Widgets im Infobereich
voice_page_indices = []   # Wird in stimmen_ermitteln befüllt

categories = ["Titel", "Genre", "Stimmenbezeichnung", "Komponist", "Arrangeur"]
category_colors = {
    "Titel": "red",
    "Genre": "blue",
    "Stimmenbezeichnung": "green",
    "Komponist": "pink",
    "Arrangeur": "purple"
}

highlight_rectangles = {}
current_scale = 1.0
current_image = None
current_image_id = None

# ----------------------- Funktion: highlight_option -----------------------
def highlight_option(category, bounding_box):
    global highlight_rectangles, current_scale
    if category in highlight_rectangles:
        viewer_canvas.delete(highlight_rectangles[category])
        del highlight_rectangles[category]
    left, top, w, h = bounding_box
    scaled_left = left * current_scale
    scaled_top = top * current_scale
    scaled_w = w * current_scale
    scaled_h = h * current_scale
    color = category_colors.get(category, "black")
    rect_id = viewer_canvas.create_rectangle(scaled_left, scaled_top, scaled_left + scaled_w, scaled_top + scaled_h, outline=color, width=3)
    highlight_rectangles[category] = rect_id

# ----------------------- Funktionen für die Vorschau -----------------------
def show_pagenumber(current_pageno, total_pages):
    page_label.config(text=f"{current_pageno} von {total_pages}")

def show_page(page_index):
    global current_page, current_scale, current_image, current_image_id
    if pdf_images and 0 <= page_index < len(pdf_images):
        viewer_canvas.delete("all")
        viewer_canvas.update_idletasks()
        viewer_width = viewer_canvas.winfo_width() or 800
        viewer_height = viewer_canvas.winfo_height() or 600

        orig_width, orig_height = pdf_images[page_index].size
        scale_factor = min(viewer_width / orig_width, viewer_height / orig_height)
        current_scale = scale_factor
        new_width = int(orig_width * scale_factor)
        new_height = int(orig_height * scale_factor)

        resized_image = pdf_images[page_index].resize((new_width, new_height), resample=Image.Resampling.LANCZOS)
        current_image = ImageTk.PhotoImage(resized_image)
        current_image_id = viewer_canvas.create_image(0, 0, anchor="nw", image=current_image)

        current_page = page_index
        show_pagenumber(current_page + 1, len(pdf_images))
        set_navigationbutton_state()

        if static_ocr_options:
            populate_info_comboboxes(static_ocr_options, global_user_info)
            for cat, info in global_user_info.items():
                highlight_option(cat, info["bounding_box"])
        elif current_page in ocr_results:
            populate_info_comboboxes(ocr_results[current_page])
            for cat, opt in ocr_results[current_page].items():
                highlight_option(cat, opt["bounding_box"])
        else:
            clear_info_area()
            for cat in list(highlight_rectangles.keys()):
                viewer_canvas.delete(highlight_rectangles[cat])
                del highlight_rectangles[cat]

def set_navigationbutton_state():
    if current_page < len(pdf_images) - 1:
        next_button.config(state="normal")
    else:
        next_button.config(state="disabled")
    if current_page >= 1:
        prev_button.config(state="normal")
    else:
        prev_button.config(state="disabled")

def previous_page():
    if current_page > 0:
        show_page(current_page - 1)

def next_page():
    if current_page < len(pdf_images) - 1:
        show_page(current_page + 1)

# ----------------------- OCR-Analyse und automatische Vorbelegung der ComboBoxen -----------------------
def analyze_current_page():
    global ocr_results, static_ocr_options, global_user_info
    for cat in list(highlight_rectangles.keys()):
        viewer_canvas.delete(highlight_rectangles[cat])
    highlight_rectangles.clear()
    global_user_info = {}
    try:
        threshold_value = int(threshold_entry.get())
    except:
        threshold_value = 70

    page = pdf_images[current_page]
    page_width, page_height = page.size
    cutoff_y = 0.25 * page_height
    confidence_threshold = threshold_value
    distance_threshold = 20

    data = pytesseract.image_to_data(page, lang="deu", output_type=Output.DICT)
    n = len(data["text"])
    groups = {}
    for i in range(n):
        text = data["text"][i].strip()
        if text:
            key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
            groups.setdefault(key, []).append(i)

    ocr_list = []
    for key, indices in groups.items():
        sorted_indices = sorted(indices, key=lambda i: data["left"][i])
        subgroups = []
        current_group = []
        for i in sorted_indices:
            if not current_group:
                current_group.append(i)
            else:
                prev = current_group[-1]
                gap = data["left"][i] - (data["left"][prev] + data["width"][prev])
                current_max_height = max(data["height"][j] for j in current_group)
                if gap > distance_threshold or ((current_max_height - data["height"][i]) / current_max_height > 0.3):
                    subgroups.append(current_group)
                    current_group = [i]
                else:
                    current_group.append(i)
        if current_group:
            subgroups.append(current_group)
        for subgroup in subgroups:
            words = [data["text"][i].strip() for i in subgroup if data["text"][i].strip()]
            if not words:
                continue
            block_text = " ".join(words)
            block_text = preprocess_text(block_text)
            lefts = [data["left"][i] for i in subgroup]
            tops = [data["top"][i] for i in subgroup]
            rights = [data["left"][i] + data["width"][i] for i in subgroup]
            bottoms = [data["top"][i] + data["height"][i] for i in subgroup]
            grp_left = min(lefts)
            grp_top = min(tops)
            grp_right = max(rights)
            grp_bottom = max(bottoms)
            grp_width = grp_right - grp_left
            grp_height = grp_bottom - grp_top
            conf_values = []
            for i in subgroup:
                try:
                    conf = int(data["conf"][i])
                    if conf > 0:
                        conf_values.append(conf)
                except:
                    continue
            avg_conf = sum(conf_values) / len(conf_values) if conf_values else 0
            if grp_top < cutoff_y and avg_conf >= confidence_threshold:
                avg_height = sum(data["height"][i] for i in subgroup) / len(subgroup)
                ocr_list.append({
                    "text": block_text,
                    "bounding_box": (grp_left, grp_top, grp_width, grp_height),
                    "avg_conf": avg_conf,
                    "avg_height": avg_height
                })
    page_dict = {}
    for opt in ocr_list:
        page_dict[opt["text"]] = opt

    ocr_results[current_page] = page_dict
    static_ocr_options = page_dict

    computed_defaults = {}
    stimmen_blocks = [opt for opt in ocr_list]
    if stimmen_blocks:
        default_stimme = min(stimmen_blocks, key=lambda o: o["bounding_box"][0])
        computed_defaults["Stimmenbezeichnung"] = default_stimme
    komponist_blocks = [opt for opt in ocr_list]
    if komponist_blocks:
        default_komponist = max(komponist_blocks, key=lambda o: o["bounding_box"][0] + o["bounding_box"][2])
        computed_defaults["Komponist"] = default_komponist
    titel_blocks = []
    for opt in ocr_list:
        bbox = opt["bounding_box"]
        center = bbox[0] + bbox[2] / 2
        deviation = abs(center - (page_width / 2))
        opt["deviation"] = deviation
        titel_blocks.append(opt)
    if titel_blocks:
        tolerance = 0.2 * page_width
        in_middle = [opt for opt in titel_blocks if opt["deviation"] <= tolerance]
        if in_middle:
            default_titel = max(in_middle, key=lambda o: o["avg_height"])
        else:
            default_titel = min(titel_blocks, key=lambda o: o["deviation"])
        computed_defaults["Titel"] = default_titel

    for cat, opt in computed_defaults.items():
        global_user_info[cat] = {
            "selected_text": opt["text"],
            "bounding_box": opt["bounding_box"],
            "avg_conf": opt["avg_conf"]
        }

    populate_info_comboboxes(page_dict, global_user_info)

# ----------------------- Funktionen für den Info-Bereich -----------------------
def populate_info_comboboxes(ocr_dict=None, stored_info=None):
    if ocr_dict is None:
        ocr_dict = {}
    clear_info_area()
    global info_data
    for cat in categories:
        row_frame = tk.Frame(info_selection_frame, bg="white")
        row_frame.pack(fill="x", pady=2)
        color_label = tk.Label(row_frame, text="■", fg=category_colors.get(cat, "black"), bg="white", font=("Arial", 12))
        color_label.grid(row=0, column=0, padx=2)
        lbl_cat = tk.Label(row_frame, text=cat, width=15, anchor="w", bg="white")
        lbl_cat.grid(row=0, column=1, padx=5)
        combo = ttk.Combobox(row_frame, state="readonly", width=40)
        options = list(ocr_dict.keys())
        combo['values'] = options
        if stored_info and cat in stored_info:
            combo.set(stored_info[cat]["selected_text"])
        else:
            combo.set("Bitte wählen...")
        combo.grid(row=0, column=2, padx=5)
        combo.bind("<<ComboboxSelected>>", lambda e, cat=cat: on_info_selected(cat))
        lbl_pos = tk.Label(row_frame, text="Position:", bg="white")
        lbl_pos.grid(row=0, column=3, padx=5)
        entry_x = tk.Entry(row_frame, width=5)
        entry_x.grid(row=0, column=4, padx=2)
        entry_y = tk.Entry(row_frame, width=5)
        entry_y.grid(row=0, column=5, padx=2)
        entry_w = tk.Entry(row_frame, width=5)
        entry_w.grid(row=0, column=6, padx=2)
        entry_h = tk.Entry(row_frame, width=5)
        entry_h.grid(row=0, column=7, padx=2)
        lbl_conf = tk.Label(row_frame, text="Erkennungsrate:", bg="white")
        lbl_conf.grid(row=0, column=8, padx=5)
        entry_conf = tk.Entry(row_frame, width=5)
        entry_conf.grid(row=0, column=9, padx=2)
        for entry in (entry_x, entry_y, entry_w, entry_h):
            entry.bind("<FocusOut>", lambda e, cat=cat: update_highlight(cat))
        entry_conf.bind("<FocusOut>", lambda e, cat=cat: update_highlight(cat))
        info_data[cat] = {
            "combobox": combo,
            "entry_x": entry_x,
            "entry_y": entry_y,
            "entry_w": entry_w,
            "entry_h": entry_h,
            "entry_conf": entry_conf
        }
        if stored_info and cat in stored_info:
            bbox = stored_info[cat]["bounding_box"]
            avg_conf = stored_info[cat]["avg_conf"]
            entry_x.insert(0, str(bbox[0]))
            entry_y.insert(0, str(bbox[1]))
            entry_w.insert(0, str(bbox[2]))
            entry_h.insert(0, str(bbox[3]))
            entry_conf.insert(0, f"{avg_conf:.1f}")
            highlight_option(cat, bbox)

def clear_info_area():
    for widget in info_selection_frame.winfo_children():
        widget.destroy()
    global info_data
    info_data = {}

def on_info_selected(category):
    selected_text = info_data[category]["combobox"].get()
    if static_ocr_options and selected_text in static_ocr_options:
        opt = static_ocr_options[selected_text]
        left, top, w, h = opt["bounding_box"]
        info_data[category]["entry_x"].delete(0, tk.END)
        info_data[category]["entry_x"].insert(0, str(left))
        info_data[category]["entry_y"].delete(0, tk.END)
        info_data[category]["entry_y"].insert(0, str(top))
        info_data[category]["entry_w"].delete(0, tk.END)
        info_data[category]["entry_w"].insert(0, str(w))
        info_data[category]["entry_h"].delete(0, tk.END)
        info_data[category]["entry_h"].insert(0, str(h))
        info_data[category]["entry_conf"].delete(0, tk.END)
        info_data[category]["entry_conf"].insert(0, f"{opt['avg_conf']:.1f}")
        highlight_option(category, opt["bounding_box"])
        global global_user_info
        global_user_info[category] = {
            "selected_text": selected_text,
            "bounding_box": opt["bounding_box"],
            "avg_conf": opt["avg_conf"]
        }

def update_highlight(category):
    try:
        x = int(info_data[category]["entry_x"].get())
        y = int(info_data[category]["entry_y"].get())
        w = int(info_data[category]["entry_w"].get())
        h = int(info_data[category]["entry_h"].get())
    except ValueError:
        return
    if w <= 0 or h <= 0:
        messagebox.showwarning("Ungültige Werte", f"Für {category} müssen Breite und Höhe > 0 sein.")
        return
    bounding_box = (x, y, w, h)
    highlight_option(category, bounding_box)
    global global_user_info
    if category in global_user_info:
        global_user_info[category]["bounding_box"] = bounding_box

    img = pdf_images[current_page]
    img_width, img_height = img.size
    x2 = min(x + w, img_width)
    y2 = min(y + h, img_height)
    if x2 <= x or y2 <= y:
        messagebox.showwarning("Ungültige Werte", f"Die berechneten Koordinaten für {category} sind ungültig.")
        return
    try:
        cropped_region = img.crop((x, y, x2, y2))
        new_text = pytesseract.image_to_string(cropped_region, lang="deu").strip()
        new_text = preprocess_text(new_text)
        if new_text:
            info_data[category]["combobox"].set(new_text)
            global_user_info[category]["selected_text"] = new_text
    except Exception as e:
        messagebox.showerror("OCR Fehler", f"Fehler bei der OCR-Erkennung: {str(e)}")

# ----------------------- "Stimmen ermitteln" (Aktualisiert mit Tabelle) -----------------------
def stimmen_ermitteln():
    global voice_page_indices
    if "Titel" not in global_user_info or "Stimmenbezeichnung" not in global_user_info:
        messagebox.showerror("Fehler", "Bitte wählen Sie in den ComboBoxen für 'Titel' und 'Stimmenbezeichnung' einen Eintrag aus.")
        return

    title_text = global_user_info["Titel"]["selected_text"]
    title_box = global_user_info["Titel"]["bounding_box"]
    voice_box = global_user_info["Stimmenbezeichnung"]["bounding_box"]

    voices_table.delete(*voices_table.get_children())
    voice_page_indices = []

    for idx, page in enumerate(pdf_images):
        page_width, page_height = page.size
        tx, ty, tw, th = title_box
        new_tx = max(0, tx - 0.1 * tw)
        new_ty = max(0, ty - 0.1 * th)
        new_tw = tw * 1.2
        new_th = th * 1.2
        title_region = page.crop((new_tx, new_ty, new_tx + new_tw, new_ty + new_th))
        ocr_title = pytesseract.image_to_string(title_region, lang="deu").strip()
        ocr_title = preprocess_text(ocr_title)
        similarity_ratio = difflib.SequenceMatcher(None, title_text.lower(), ocr_title.lower()).ratio()
        if idx == 0 or similarity_ratio >= 0.7:
            titel_found = "Ja"
        else:
            titel_found = "Nein"

        vx, vy, vw, vh = voice_box
        new_vx = max(0, vx - 0.3 * vw)
        new_vy = max(0, vy - 0.3 * vh)
        new_vw = vw * 1.6
        new_vh = vh * 1.6
        min_voice_width = 0.3 * page_width
        if new_vw < min_voice_width:
            new_vw = min_voice_width
        voice_region = page.crop((new_vx, new_vy, new_vx + new_vw, new_vy + new_vh))
        ocr_voice = pytesseract.image_to_string(voice_region, lang="deu").strip()
        ocr_voice = preprocess_text(ocr_voice)
        voices_table.insert("", "end", values=(idx + 1, titel_found, ocr_voice))
        voice_page_indices.append(idx)
    
    # Update des PDF-Buttons abhängig von vorhandenen Einträgen
    if voices_table.get_children():
        stimmen_pdf_button.config(state="normal")
    else:
        stimmen_pdf_button.config(state="disabled")

# ----------------------- Neue Funktion: Stimmen aufteilen und PDFs erzeugen -----------------------
def stimmen_aufteilen():
    output_dir = filedialog.askdirectory(title="Ausgabeordner für einzelne Stimmen PDFs")
    if not output_dir:
        return
    voice_starts = []
    for child in voices_table.get_children():
        values = voices_table.item(child)["values"]
        if values[1] == "Ja" and values[2].strip() != "":
            try:
                page_index = int(values[0]) - 1
            except:
                continue
            voice_starts.append((page_index, values[2].strip()))
    voice_starts.sort(key=lambda x: x[0])
    voices = []
    for i, (start_page, voice_text) in enumerate(voice_starts):
        end_page = voice_starts[i+1][0] - 1 if i+1 < len(voice_starts) else len(pdf_images) - 1
        voices.append((start_page, end_page, voice_text))
    for (start, end, voice_text) in voices:
        voice_filename_part = voice_text.replace(".", "")
        title_text = global_user_info.get("Titel", {}).get("selected_text", "Unbekannt")
        filename = f"{title_text} - {voice_filename_part}.pdf"
        output_path = os.path.join(output_dir, filename)
        pages = pdf_images[start:end+1]
        if pages:
            pages_rgb = [p.convert("RGB") for p in pages]
            try:
                pages_rgb[0].save(output_path, "PDF", resolution=100.0, save_all=True, append_images=pages_rgb[1:])
            except Exception as e:
                messagebox.showerror("Fehler", f"Fehler beim Erzeugen von {output_path}:\n{str(e)}")
    generate_noten_index_xml(output_dir, global_user_info, voices)
    messagebox.showinfo("Erfolg", "Die PDFs und NotenIndex.xml wurden erfolgreich erzeugt.")

def generate_noten_index_xml(output_dir, global_info, voices):
    root_elem = Element("NotenIndex")
    stueck_elem = SubElement(root_elem, "Stueck")
    for key in ["Titel", "Genre", "Komponist", "Arrangeur"]:
        value = global_info.get(key, {}).get("selected_text", "")
        sub_elem = SubElement(stueck_elem, key)
        sub_elem.text = value
    stimmen_container = SubElement(root_elem, "Stimmen")
    for (start, end, voice_text) in voices:
        voice_filename_part = voice_text.replace(".", "")
        title_text = global_info.get("Titel", {}).get("selected_text", "Unbekannt")
        filename = f"{title_text} - {voice_filename_part}.pdf"
        stimme_elem = SubElement(stimmen_container, "Stimme")
        designation_elem = SubElement(stimme_elem, "Stimmenbezeichnung")
        designation_elem.text = voice_text
        file_elem = SubElement(stimme_elem, "Dateiname")
        file_elem.text = filename
        start_elem = SubElement(stimme_elem, "StartSeite")
        start_elem.text = str(start + 1)
        end_elem = SubElement(stimme_elem, "EndSeite")
        end_elem.text = str(end + 1)
    indent(root_elem)
    xml_str = tostring(root_elem, encoding="unicode")
    xml_output_path = os.path.join(output_dir, "NotenIndex.xml")
    try:
        with open(xml_output_path, "w", encoding="utf-8") as f:
            f.write(xml_str)
    except Exception as e:
        messagebox.showerror("Fehler", f"Fehler beim Schreiben der NotenIndex.xml:\n{str(e)}")

# ----------------------- Dokument laden, Seiten ausrichten und normalisieren -----------------------
def load_document():
    global pdf_images, current_page, global_user_info
    file_path = filedialog.askopenfilename(
        title="Scan-Dokument auswählen",
        filetypes=[("PDF files", "*.pdf")]
    )
    if not file_path:
        return
    try:
        if poppler_path:
            pdf_images = convert_from_path(file_path, poppler_path=poppler_path)
        else:
            pdf_images = convert_from_path(file_path)
    except Exception as e:
        messagebox.showerror("Fehler", f"Fehler beim Laden des Dokuments:\n{str(e)}")
        return
    if not pdf_images:
        messagebox.showwarning("Warnung", "Keine Seiten im Dokument gefunden.")
        return
    progress_window = tk.Toplevel(root)
    progress_window.title("Seiten optimieren")
    progress_label = tk.Label(progress_window, text="Optimierung der Seiten läuft...")
    progress_label.pack(pady=10)
    progress_bar = ttk.Progressbar(progress_window, length=300, mode="determinate")
    progress_bar.pack(pady=10)
    progress_bar["maximum"] = len(pdf_images)
    for i in range(len(pdf_images)):
        img = pdf_images[i]
        img = deskew(img)
        img = normalize_margins(img, margin=10)
        pdf_images[i] = img
        progress_bar["value"] = i + 1
        progress_window.update_idletasks()
    progress_window.destroy()
    current_page = 0
    global_user_info = {}
    show_page(current_page)
    stimmen_button.config(state="normal")
    # Initial den PDF-Button deaktivieren, bis Einträge vorhanden sind
    stimmen_pdf_button.config(state="disabled")
    analyze_current_page()

# ----------------------- Callback für Stimmenzeilenauswahl in der Tabelle -----------------------
def on_voice_selected(event):
    selected_item = voices_table.selection()
    if not selected_item:
        return
    item = voices_table.item(selected_item)
    page_index = int(item["values"][0]) - 1
    show_page(page_index)

# ----------------------- GUI-Aufbau -----------------------
root = tk.Tk()
root.title("Scan-Dokument Viewer")
root.state("zoomed")
main_frame = tk.Frame(root)
main_frame.pack(fill=tk.BOTH, expand=True)
main_frame.columnconfigure(0, weight=1)
main_frame.columnconfigure(1, weight=1)
main_frame.rowconfigure(0, weight=1)
# LINKER BEREICH (Vorschau)
left_frame = tk.Frame(main_frame, bg="lightgray")
left_frame.grid(row=0, column=0, sticky="nsew", padx=10, pady=10)
viewer_canvas = tk.Canvas(left_frame, bg="white")
viewer_canvas.pack(fill=tk.BOTH, expand=True)
nav_frame = tk.Frame(left_frame)
nav_frame.pack(pady=5)
prev_button = tk.Button(nav_frame, text="‹", command=previous_page, state="disabled")
prev_button.pack(side="left", padx=5)
page_label = tk.Label(nav_frame, text="", font=("Arial", 12))
page_label.pack(side="left", padx=5)
next_button = tk.Button(nav_frame, text="›", command=next_page, state="disabled")
next_button.pack(side="left", padx=5)
button_frame = tk.Frame(left_frame)
button_frame.pack(pady=10)
load_button = tk.Button(button_frame, text="Scan-Dokument einlesen", command=load_document)
load_button.pack(side="left", padx=5)
# RECHTER BEREICH (Erkannte Informationen und Stimmen)
right_frame = tk.Frame(main_frame, bg="white")
right_frame.grid(row=0, column=1, sticky="nsew", padx=10, pady=10)
threshold_frame = tk.Frame(right_frame, bg="white")
threshold_frame.pack(fill="x", padx=10, pady=(10,5))
lbl_threshold = tk.Label(threshold_frame, text="Schwellwert für Erkennung:", bg="white")
lbl_threshold.pack(side="left", padx=5)
threshold_entry = tk.Entry(threshold_frame, width=5)
threshold_entry.insert(0, "70")
threshold_entry.pack(side="left", padx=5)
btn_analyze = tk.Button(threshold_frame, text="Neu analysieren", command=analyze_current_page)
btn_analyze.pack(side="left", padx=5)
info_selection_frame = tk.Frame(right_frame, bg="white")
info_selection_frame.pack(side="top", fill="x", padx=10, pady=(5,5))
info_header = tk.Label(info_selection_frame, text="Erkannte Informationen", font=("Arial", 12, "bold"), bg="white")
info_header.pack(side="top", anchor="w", pady=(0,10))
populate_info_comboboxes()
voices_frame = tk.Frame(right_frame, bg="white")
voices_frame.pack(side="top", fill="both", expand=True, padx=10, pady=(5,10))
voices_header_frame = tk.Frame(voices_frame, bg="white")
voices_header_frame.pack(side="top", fill="x")
voices_header = tk.Label(voices_header_frame, text="Erkannte Stimmen", font=("Arial", 12, "bold"), bg="white")
voices_header.pack(side="left", anchor="w")
# Zuerst den Button "Stimmen ermitteln"
stimmen_button = tk.Button(voices_header_frame, text="Stimmen ermitteln", command=stimmen_ermitteln, state="disabled")
stimmen_button.pack(side="left", anchor="w", padx=5)
# Dann rechts daneben: "Einzelne Stimmen PDFs erzeugen"
stimmen_pdf_button = tk.Button(voices_header_frame, text="Einzelne Stimmen PDFs erzeugen", command=stimmen_aufteilen, state="disabled")
stimmen_pdf_button.pack(side="left", padx=5)
voices_table = ttk.Treeview(voices_frame, columns=("seitennr", "titel", "stimme"), show="headings")
voices_table.heading("seitennr", text="Seitennr", anchor="e")
voices_table.heading("titel", text="Titel gefunden", anchor="w")
voices_table.heading("stimme", text="Ermittelte Stimme", anchor="w")
voices_table.column("seitennr", width=70, minwidth=60, stretch=tk.NO, anchor="e")
voices_table.column("titel", width=90, minwidth=80, stretch=tk.NO, anchor="w")
voices_table.column("stimme", width=300, minwidth=100, stretch=tk.YES, anchor="w")
voices_table.pack(fill=tk.BOTH, expand=True)
voices_table.bind("<<TreeviewSelect>>", on_voice_selected)
voices_scrollbar = tk.Scrollbar(voices_frame, orient="vertical", command=voices_table.yview)
voices_table.configure(yscrollcommand=voices_scrollbar.set)
voices_scrollbar.pack(side="right", fill="y")
root.mainloop()
