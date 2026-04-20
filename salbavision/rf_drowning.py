# =============================================================================
# rf_drowning.py  — Standalone drowning detection viewer with confirmation
# =============================================================================
#
# Runs the Roboflow InferencePipeline and shows a live annotated window.
# Draws ALL model predictions (no suppression filtering).
# Includes time-based drowning confirmation (from drowning-delay-v2.py).
# No Flask, no Supabase — just detection + visual output + confirmation timer.
#
# RUN:
#   py rf_drowning.py
#   Press q in the window to stop.
#
# =============================================================================

import os
import time
import signal
import atexit
import platform
import threading
import cv2
import numpy as np
from inference import InferencePipeline
from PIL import Image, ImageDraw, ImageFont

# =============================================================================
# CONFIG
# =============================================================================

RF_API_KEY   = "yYf0oFRqVThzJtqnC6D4"

# RF_MODEL_ID = "aqw3rfaq3wcqrq2r/9" # splashsafe yolov11 accurate
RF_MODEL_ID = "aqw3rfaq3wcqrq2r/12" # splashsafe yolov11 accurate
# RF_MODEL_ID = "aqw3rfaq3wcqrq2r-d778t/4" #akwatek yolov11 accurate
# RF_MODEL_ID = "aqw3rfaq3wcqrq2r-d778t/1" #akwatek rf-detr small
# RF_MODEL_ID = "iy-htoyq3tayectyk/5" # freelance rf-detr small

# VIDEO_SOURCE = r"C:\dev\freelance_systems\salbavision\videos\IMG_1205.MOV"
VIDEO_SOURCE = "rtsp://admin23:admin123@192.180.100.30:554/stream1"
# VIDEO_SOURCE = r"C:\Users\jessicahd\Documents\GitHub\DROWNING_DETECTION_SYSTEM\salbavision-v2\videos\IMG_1205.MOV"

MAX_FPS = 60

FONT_PATH = "C:/Windows/Fonts/arial.ttf"

# --- Drowning confirmation (from drowning-delay-v2.py) ---
DROWNING_THRESHOLD   = 2.0   # seconds of continuous detection to confirm
DETECTION_RESET_TIME = 3.0   # seconds without drowning to reset timer
HEARTBEAT_INTERVAL   = 5.0   # seconds between repeated console alerts while confirmed

CLASS_COLORS_BGR = {
    "drowning":     (0, 0, 255),
    "out of water": (0, 255, 0),
    "swimming":     (255, 0, 127),
}

# How much of the screen the window should occupy (0.0 – 1.0)
WINDOW_SCALE = 0.667

# =============================================================================
# SCREEN RESOLUTION DETECTION
# =============================================================================

def get_screen_size():
    """Return (width, height) of the primary monitor."""
    try:
        if platform.system() == "Windows":
            import ctypes
            user32 = ctypes.windll.user32
            user32.SetProcessDPIAware()
            return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
        else:
            import tkinter as tk
            root = tk.Tk()
            root.withdraw()
            w, h = root.winfo_screenwidth(), root.winfo_screenheight()
            root.destroy()
            return w, h
    except Exception:
        return 1920, 1080


def calc_window_size(frame_h, frame_w, screen_w, screen_h):
    max_w = int(screen_w * WINDOW_SCALE)
    max_h = int(screen_h * WINDOW_SCALE)
    scale = min(max_w / frame_w, max_h / frame_h, 1.0)
    return int(frame_w * scale), int(frame_h * scale)


SCREEN_W, SCREEN_H = get_screen_size()
print(f"[DISPLAY] Screen: {SCREEN_W}x{SCREEN_H}  ->  window target: "
      f"{int(SCREEN_W * WINDOW_SCALE)}x{int(SCREEN_H * WINDOW_SCALE)}")

WINDOW_NAME  = "Drowning Detection"
_win_ready   = False

# =============================================================================
# DROWNING CONFIRMATION STATE  (from drowning-delay-v2.py)
# =============================================================================

drowning_start_time = None
drowning_confirmed  = False
last_drowning_time  = None
last_heartbeat_time = None
_state_lock         = threading.Lock()


def process_drowning_detection(drowning_detected_in_frame: bool):
    """Time-based confirmation — matches drowning-delay-v2.py logic.
    Simple boolean input: True if ANY drowning prediction exists in this frame.
    """
    global drowning_start_time, drowning_confirmed
    global last_drowning_time, last_heartbeat_time

    now = time.time()

    with _state_lock:
        if drowning_detected_in_frame:
            last_drowning_time = now

            if drowning_start_time is None:
                drowning_start_time = now
                print(f"[CONFIRM] Drowning detected - confirming ({DROWNING_THRESHOLD}s threshold)")
            else:
                duration = now - drowning_start_time
                if duration >= DROWNING_THRESHOLD:
                    if not drowning_confirmed:
                        drowning_confirmed  = True
                        last_heartbeat_time = now
                        print(f"[CONFIRM] *** DROWNING CONFIRMED ({duration:.1f}s) ***")
                    else:
                        if (now - last_heartbeat_time) >= HEARTBEAT_INTERVAL:
                            last_heartbeat_time = now
                            total = now - drowning_start_time
                            print(f"[CONFIRM] Drowning active ({total:.0f}s)")
        else:
            if last_drowning_time is not None:
                gap = now - last_drowning_time
                if gap >= DETECTION_RESET_TIME:
                    if drowning_confirmed:
                        total = last_drowning_time - drowning_start_time
                        print(f"[CONFIRM] Alarm cleared ({total:.1f}s)")
                    elif drowning_start_time is not None:
                        buildup = last_drowning_time - drowning_start_time
                        print(f"[CONFIRM] Reset ({buildup:.1f}s - below threshold)")

                    drowning_start_time = None
                    drowning_confirmed  = False
                    last_drowning_time  = None
                    last_heartbeat_time = None

# =============================================================================
# GPU SETUP
# =============================================================================

try:
    import torch
    if torch.cuda.is_available():
        os.environ["CUDA_VISIBLE_DEVICES"] = "0"
        os.environ["ONNXRUNTIME_EXECUTION_PROVIDERS"] = (
            "CUDAExecutionProvider,CPUExecutionProvider"
        )
        print(f"[GPU] {torch.cuda.get_device_name(0)} - using GPU")
    else:
        print("[GPU] No CUDA detected - running on CPU")
except ImportError:
    print("[GPU] PyTorch not installed")

# =============================================================================
# FONT
# =============================================================================

try:
    FONT    = ImageFont.truetype(FONT_PATH, 20)
    FONT_SM = ImageFont.truetype(FONT_PATH, 16)
except OSError:
    FONT    = ImageFont.load_default()
    FONT_SM = FONT

# =============================================================================
# PREDICTION CALLBACK
# =============================================================================

def handle_prediction(prediction_data, frame):
    global _win_ready

    if hasattr(frame, "image"):
        frame = frame.image
    if not isinstance(frame, np.ndarray):
        return

    fh, fw = frame.shape[:2]
    win_w, win_h = calc_window_size(fh, fw, SCREEN_W, SCREEN_H)

    if not _win_ready:
        cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(WINDOW_NAME, win_w, win_h)
        cx = (SCREEN_W - win_w) // 2
        cy = (SCREEN_H - win_h) // 2
        cv2.moveWindow(WINDOW_NAME, cx, cy)
        _win_ready = True

    predictions = prediction_data.get("predictions", [])

    # --- Drowning check (simple boolean, like drowning-delay-v2.py) ---
    drowning_detected = any(
        isinstance(p, dict) and p.get("class") == "drowning"
        for p in predictions
    )
    process_drowning_detection(drowning_detected)

    # --- Draw ALL predictions (no suppression — matches working drowning.py) ---
    pil_img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    draw    = ImageDraw.Draw(pil_img)

    for pred in predictions:
        if not isinstance(pred, dict):
            continue

        x, y = pred.get("x", 0), pred.get("y", 0)
        w, h = pred.get("width", 0), pred.get("height", 0)
        cls  = pred.get("class", "")
        conf = pred.get("confidence", 0.0)

        color_bgr = CLASS_COLORS_BGR.get(cls, (255, 255, 255))
        color_rgb = color_bgr[::-1]

        pt1 = (int(x - w / 2), int(y - h / 2))
        pt2 = (int(x + w / 2), int(y + h / 2))
        box_w = 8 if cls == "drowning" else 6
        draw.rectangle([pt1, pt2], outline=color_rgb, width=box_w)

        label = f"{cls} ({conf:.2f})"

        # Append confirmation timer to drowning labels (from drowning-delay-v2.py)
        if cls == "drowning":
            with _state_lock:
                dc = drowning_confirmed
                ds = drowning_start_time
                lh = last_heartbeat_time
            if dc:
                if lh is not None:
                    next_hb = HEARTBEAT_INTERVAL - (time.time() - lh)
                    label += f" [ACTIVE - Next:{next_hb:.1f}s]"
                else:
                    label += " [CONFIRMED]"
            elif ds is not None:
                elapsed = time.time() - ds
                label += f" [{elapsed:.1f}s/{DROWNING_THRESHOLD}s]"

        tb = draw.textbbox((0, 0), label, font=FONT)
        tw, th = tb[2] - tb[0], tb[3] - tb[1]
        lx = pt1[0]
        ly = pt1[1] - th - 4 if pt1[1] - th - 4 >= 0 else pt1[1] + 4
        draw.rectangle([lx, ly, lx + tw + 6, ly + th + 4], fill=color_rgb)
        draw.text((lx + 3, ly + 2), label, font=FONT, fill="white")

    # --- Status overlay ---
    with _state_lock:
        dc = drowning_confirmed
        ds = drowning_start_time

    if dc:
        status_text  = "DROWNING ALERT!"
        status_color = (255, 0, 0)
    elif ds is not None:
        remaining    = max(0.0, DROWNING_THRESHOLD - (time.time() - ds))
        status_text  = f"CONFIRMING ({remaining:.1f}s)"
        status_color = (255, 140, 0)
    else:
        status_text  = "MONITORING"
        status_color = (0, 150, 0)

    tb = draw.textbbox((0, 0), status_text, font=FONT)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    draw.rectangle([10, 10, 10 + tw + 12, 10 + th + 8], fill=status_color)
    draw.text((16, 14), status_text, font=FONT, fill="white")

    out = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
    cv2.imshow(WINDOW_NAME, out)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        cv2.destroyAllWindows()
        try:
            pipeline.stop()
        except Exception:
            pass
        os._exit(0)


# =============================================================================
# RUN
# =============================================================================

pipeline = InferencePipeline.init(
    api_key=RF_API_KEY,
    model_id=RF_MODEL_ID,
    video_reference=VIDEO_SOURCE,
    on_prediction=handle_prediction,
    max_fps=MAX_FPS,
)


def _shutdown(sig=None, frame=None):
    try:
        pipeline.stop()
    except Exception:
        pass
    cv2.destroyAllWindows()

signal.signal(signal.SIGINT, _shutdown)
signal.signal(signal.SIGTERM, _shutdown)
atexit.register(_shutdown)

pipeline.start()
pipeline.join()
