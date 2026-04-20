# =============================================================================
# rf_stream_delay.py
# Roboflow Stream Bridge with Time-Based Drowning Confirmation
# =============================================================================
#
# Variant of rf_stream_bridge.py with drowning confirmation from
# drowning-delay-v2.py.  Draws ALL model predictions (no suppression).
# Alert fires only after DROWNING_THRESHOLD seconds of continuous detection.
#
# REQUIREMENTS
#   pip install inference opencv-python pillow flask supabase pygame
#   (GPU) pip install inference-gpu + PyTorch with CUDA
#
# RUN
#   python rf_stream_delay.py
#   Stream -> http://localhost:5001/video_feed
#   Alert  -> http://localhost:5001/latest_alert
#
# =============================================================================

import os
import signal
import time
import threading

import cv2
import numpy as np
import pygame
from flask import Flask, Response, jsonify, request
from inference import InferencePipeline
from PIL import Image, ImageDraw, ImageFont
from supabase import create_client, Client

# =============================================================================
# CONFIG
# =============================================================================

# --- Roboflow ---
RF_API_KEY  = "yYf0oFRqVThzJtqnC6D4"

# RF_MODEL_ID = "aqw3rfaq3wcqrq2r/9" # splashsafe yolov11 accurate
RF_MODEL_ID = "aqw3rfaq3wcqrq2r/12" # splashsafe yolov11 accurate
# RF_MODEL_ID = "aqw3rfaq3wcqrq2r-d778t/4" #akwatek yolov11 accurate
# RF_MODEL_ID = "aqw3rfaq3wcqrq2r-d778t/1" #akwatek rf-detr small
# RF_MODEL_ID = "iy-htoyq3tayectyk/5" # freelance rf-detr small

# --- Video source ---
# VIDEO_SOURCE = r"C:\dev\freelance_systems\salbavision\videos\IMG_1205.MOV"
VIDEO_SOURCE = r"C:\Users\jessicahd\Documents\GitHub\DROWNING_DETECTION_SYSTEM\salbavision-v2\videos\IMG_1205.MOV"

MAX_FPS = 15

# --- Supabase ---
SUPABASE_URL = "https://yzohitznmgtzdkzyoztf.supabase.co"
SUPABASE_KEY = "sb_secret_Q8_z2vsv5-x-KxSk25AJjQ_ONbMzgKF"

# --- Audio ---
AUDIO_ENABLED = True
SIREN_FILE    = "siren.mp3"

# --- Drowning confirmation (from drowning-delay-v2.py) ---
DROWNING_THRESHOLD    = 2.0   # seconds of continuous detection to confirm alert
DETECTION_RESET_TIME  = 3.0   # seconds without drowning to fully reset timer
HEARTBEAT_INTERVAL    = 5.0   # seconds between repeated Supabase log_alert calls

# --- RTSP pre-check timeout (seconds) ---
RTSP_CHECK_TIMEOUT = 8

# --- Pipeline retry delay on source error (seconds) ---
PIPELINE_RETRY_DELAY = 10

# --- Display / stream (overridden by hardware profile below) ---
FONT_PATH = "C:/Windows/Fonts/arial.ttf"

CLASS_COLORS_BGR = {
    "drowning":     (0, 0, 255),
    "out of water": (0, 255, 0),
    "swimming":     (255, 0, 127),
}

# =============================================================================
# HARDWARE PROFILE  — auto-detected at startup
# =============================================================================

def _detect_hardware():
    """Returns (has_gpu: bool, gpu_name: str | None)"""
    try:
        import torch
        if torch.cuda.is_available():
            return True, torch.cuda.get_device_name(0)
    except ImportError:
        pass
    return False, None

HAS_GPU, GPU_NAME = _detect_hardware()

if HAS_GPU:
    MAX_FPS       = 15
    DISPLAY_WIDTH = 960
    JPEG_QUALITY  = 80
    print(f"[HW] GPU detected: {GPU_NAME} - high-performance profile")
    os.environ["CUDA_VISIBLE_DEVICES"] = "0"
    os.environ["ONNXRUNTIME_EXECUTION_PROVIDERS"] = (
        "CUDAExecutionProvider,CPUExecutionProvider"
    )
else:
    MAX_FPS       = 5
    DISPLAY_WIDTH = 800
    JPEG_QUALITY  = 75
    print("[HW] No GPU - CPU profile (5 fps, 800px, q75)")

# =============================================================================
# RUNTIME STATE
# =============================================================================

processed_frame = None
latest_alert    = None
frame_lock      = threading.Lock()

# Drowning confirmation state (from drowning-delay-v2.py)
drowning_start_time  = None
drowning_confirmed   = False
last_drowning_time   = None
last_heartbeat_time  = None
_state_lock          = threading.Lock()

# Pipeline lifecycle status
PIPELINE_STATUS  = "starting"
PIPELINE_ERROR   = None
_status_lock     = threading.Lock()

# =============================================================================
# FLASK APP
# =============================================================================

app = Flask(__name__)

# =============================================================================
# SUPABASE
# =============================================================================

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# =============================================================================
# AUDIO
# =============================================================================

if AUDIO_ENABLED:
    try:
        pygame.mixer.pre_init(44100, -16, 2, 2048)
        pygame.mixer.init()
        pygame.mixer.music.load(SIREN_FILE)
        print("Siren loaded")
    except Exception as e:
        AUDIO_ENABLED = False
        print("Audio disabled:", e)


def play_siren():
    if AUDIO_ENABLED:
        try:
            if not pygame.mixer.music.get_busy():
                pygame.mixer.music.play(-1)
        except Exception as e:
            print("Audio play error:", e)


def stop_siren():
    if AUDIO_ENABLED:
        try:
            pygame.mixer.music.stop()
        except Exception as e:
            print("Audio stop error:", e)


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
# HELPERS
# =============================================================================

def resize_for_display(frame: np.ndarray, target_width: int = DISPLAY_WIDTH) -> np.ndarray:
    h, w = frame.shape[:2]
    if w <= target_width:
        return frame
    scale = target_width / w
    return cv2.resize(frame, (target_width, int(h * scale)), interpolation=cv2.INTER_AREA)


def log_alert(confidence: float, label: str = "Drowning Detected"):
    global latest_alert
    try:
        data = {
            "camera_id":     "CCTV1",
            "alert_message": label,
            "status":        "ongoing",
            "confidence":    confidence,
            "alert_time":    time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        supabase.table("alerts").insert(data).execute()
    except Exception as e:
        print("Supabase alert error:", e)

    latest_alert = {
        "message":    label,
        "confidence": round(confidence * 100, 1),
        "timestamp":  time.time(),
    }


# =============================================================================
# DRAWING  (single PIL pass — boxes + overlay in one conversion)
# =============================================================================

def draw_frame(frame: np.ndarray, predictions: list) -> np.ndarray:
    """Draw all predictions + status overlay in a single PIL pass.
    One BGR->RGB->PIL->draw->RGB->BGR instead of two (saves ~50% draw time).
    """
    pil  = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil)

    # --- Bounding boxes + labels ---
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
        box_w = 8 if cls == "drowning" else 4
        draw.rectangle([pt1, pt2], outline=color_rgb, width=box_w)

        label = f"{cls.upper()} {conf * 100:.1f}%"

        # Append confirmation timer to drowning labels
        if cls == "drowning":
            with _state_lock:
                ds = drowning_start_time
                dc = drowning_confirmed
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

    # --- Status overlay (same PIL canvas, no extra conversion) ---
    with _state_lock:
        dc = drowning_confirmed
        ds = drowning_start_time

    if dc:
        status_text  = "DROWNING ALERT!"
        status_color = (255, 0, 0)
    elif ds is not None:
        remaining = max(0.0, DROWNING_THRESHOLD - (time.time() - ds))
        status_text  = f"CONFIRMING ({remaining:.1f}s)"
        status_color = (255, 140, 0)
    else:
        status_text  = "MONITORING"
        status_color = (0, 150, 0)

    tb = draw.textbbox((0, 0), status_text, font=FONT)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    draw.rectangle([10, 10, 10 + tw + 12, 10 + th + 8], fill=status_color)
    draw.text((16, 14), status_text, font=FONT, fill="white")

    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


# =============================================================================
# DROWNING CONFIRMATION  (from drowning-delay-v2.py)
# =============================================================================

def process_drowning_detection(drowning_detected_in_frame: bool, best_drown_conf: float):
    """Time-based confirmation state machine.
    Simple boolean input: True if ANY drowning prediction exists in this frame.
    Fires siren + Supabase alert after DROWNING_THRESHOLD continuous seconds.
    """
    global drowning_start_time, drowning_confirmed
    global last_drowning_time, last_heartbeat_time

    now = time.time()

    with _state_lock:
        if drowning_detected_in_frame:
            last_drowning_time = now

            if drowning_start_time is None:
                drowning_start_time = now
                print(f"[DELAY] Drowning detected - confirming ({DROWNING_THRESHOLD}s threshold)")
            else:
                duration = now - drowning_start_time

                if duration >= DROWNING_THRESHOLD:
                    if not drowning_confirmed:
                        drowning_confirmed  = True
                        last_heartbeat_time = now
                        play_siren()
                        log_alert(best_drown_conf if best_drown_conf > 0 else 0.50)
                        print(f"[DELAY] DROWNING CONFIRMED ({duration:.1f}s)")
                    else:
                        if (now - last_heartbeat_time) >= HEARTBEAT_INTERVAL:
                            last_heartbeat_time = now
                            log_alert(best_drown_conf if best_drown_conf > 0 else 0.50)
                            total = now - drowning_start_time
                            print(f"[DELAY] Heartbeat ({total:.0f}s active)")
        else:
            if last_drowning_time is not None:
                gap = now - last_drowning_time

                if gap >= DETECTION_RESET_TIME:
                    if drowning_confirmed:
                        total = last_drowning_time - drowning_start_time
                        stop_siren()
                        print(f"[DELAY] Alarm cleared ({total:.1f}s)")
                    elif drowning_start_time is not None:
                        buildup = last_drowning_time - drowning_start_time
                        print(f"[DELAY] Detection reset ({buildup:.1f}s - below threshold)")

                    drowning_start_time = None
                    drowning_confirmed  = False
                    last_drowning_time  = None
                    last_heartbeat_time = None


# =============================================================================
# PREDICTION CALLBACK  (called by InferencePipeline on every frame)
# =============================================================================

def handle_prediction(prediction_data, frame):
    global processed_frame

    if hasattr(frame, "image"):
        frame = frame.image
    if not isinstance(frame, np.ndarray):
        return

    predictions = prediction_data.get("predictions", [])

    # --- Drowning check (simple boolean, like drowning-delay-v2.py) ---
    best_drown_conf = 0.0
    drowning_detected = False
    for pred in predictions:
        if isinstance(pred, dict) and pred.get("class") == "drowning":
            drowning_detected = True
            best_drown_conf = max(best_drown_conf, pred.get("confidence", 0.0))

    # --- Time-based confirmation ---
    process_drowning_detection(drowning_detected, best_drown_conf)

    # --- Draw (single PIL pass — boxes + overlay together) ---
    display = draw_frame(frame.copy(), predictions)
    display = resize_for_display(display, DISPLAY_WIDTH)

    with frame_lock:
        processed_frame = display


# =============================================================================
# FLASK — MJPEG STREAM
# =============================================================================

def generate():
    while True:
        with frame_lock:
            frame = processed_frame

        if frame is None:
            time.sleep(0.01)
            continue

        ret, buffer = cv2.imencode(
            ".jpg", frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]
        )
        if not ret:
            continue

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n"
            + buffer.tobytes()
            + b"\r\n"
        )


@app.route("/video_feed")
def video_feed():
    return Response(
        generate(),
        mimetype="multipart/x-mixed-replace; boundary=frame",
    )


@app.route("/latest_alert")
def latest_alert_api():
    return jsonify(latest_alert or {
        "message": None, "confidence": None, "timestamp": None
    })


@app.route("/status")
def status_api():
    with _state_lock:
        dc = drowning_confirmed
        ds = drowning_start_time
    confirming_for = round(time.time() - ds, 1) if ds and not dc else None
    with _status_lock:
        return jsonify({
            "pipeline":       PIPELINE_STATUS,
            "error":          PIPELINE_ERROR,
            "source":         str(VIDEO_SOURCE),
            "hardware":       "GPU" if HAS_GPU else "CPU",
            "fps":            MAX_FPS,
            "width":          DISPLAY_WIDTH,
            "alarm_active":   dc,
            "confirming_for": confirming_for,
        })


# --- Camera management ---

@app.route("/api/cameras", methods=["GET"])
def get_cameras():
    try:
        res = supabase.table("cameras").select("*").execute()
        return jsonify(res.data), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/cameras", methods=["POST"])
def add_camera():
    try:
        data = request.json
        if not data or "id" not in data or "rtsp_url" not in data:
            return jsonify({"error": "Missing required fields"}), 400
        cam_data = {
            "id":        data["id"],
            "rtsp_url":  data["rtsp_url"],
            "is_active": data.get("is_active", True),
        }
        res = supabase.table("cameras").upsert(cam_data, on_conflict=["id"]).execute()
        return jsonify(res.data), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/cameras/<cam_id>", methods=["DELETE"])
def delete_camera(cam_id):
    try:
        res = supabase.table("cameras").delete().eq("id", cam_id).execute()
        return jsonify(res.data), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# =============================================================================
# MAIN
# =============================================================================

def register_camera():
    try:
        supabase.table("cameras").upsert(
            {"id": "CCTV1", "rtsp_url": str(VIDEO_SOURCE), "is_active": True},
            on_conflict=["id"],
        ).execute()
        print("Camera registered in Supabase")
    except Exception as e:
        print("Camera registration error:", e)


def _check_rtsp(url: str, timeout: int = RTSP_CHECK_TIMEOUT) -> bool:
    if not str(url).startswith("rtsp://"):
        return True
    try:
        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout * 1000)
        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, timeout * 1000)
        ok = cap.isOpened()
        cap.release()
        return ok
    except Exception:
        return False


_pipeline_ref = None

def _run_pipeline():
    global PIPELINE_STATUS, PIPELINE_ERROR, _pipeline_ref

    while True:
        if str(VIDEO_SOURCE).startswith("rtsp://"):
            print(f"[PIPELINE] Checking source reachability ({RTSP_CHECK_TIMEOUT}s timeout)...")
            if not _check_rtsp(VIDEO_SOURCE):
                with _status_lock:
                    PIPELINE_STATUS = "error"
                    PIPELINE_ERROR  = f"Source unreachable: {VIDEO_SOURCE}"
                print(f"[PIPELINE] Source unreachable - retrying in {PIPELINE_RETRY_DELAY}s")
                time.sleep(PIPELINE_RETRY_DELAY)
                continue
            print("[PIPELINE] Source reachable")

        try:
            with _status_lock:
                PIPELINE_STATUS = "starting"
                PIPELINE_ERROR  = None

            pipeline = InferencePipeline.init(
                api_key=RF_API_KEY,
                model_id=RF_MODEL_ID,
                video_reference=VIDEO_SOURCE,
                on_prediction=handle_prediction,
                max_fps=MAX_FPS,
            )
            _pipeline_ref = pipeline

            with _status_lock:
                PIPELINE_STATUS = "running"

            print("[PIPELINE] Started")
            pipeline.start()
            pipeline.join()

        except Exception as e:
            with _status_lock:
                PIPELINE_STATUS = "error"
                PIPELINE_ERROR  = str(e)
            print(f"[PIPELINE] Error: {e} - retrying in {PIPELINE_RETRY_DELAY}s")

        time.sleep(PIPELINE_RETRY_DELAY)


if __name__ == "__main__":
    register_camera()

    def _shutdown(sig, frame):
        print("\n[SHUTDOWN] Stopping...")
        with _status_lock:
            global PIPELINE_STATUS
            PIPELINE_STATUS = "stopped"
        if _pipeline_ref:
            try:
                _pipeline_ref.stop()
            except Exception:
                pass
        stop_siren()
        os._exit(0)

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    t = threading.Thread(target=_run_pipeline, daemon=True)
    t.start()

    print("[SERVER] Running - time-based confirmation mode")
    print(f"  Threshold : {DROWNING_THRESHOLD}s continuous detection")
    print(f"  Reset gap : {DETECTION_RESET_TIME}s")
    print(f"  Heartbeat : {HEARTBEAT_INTERVAL}s")
    print("  Stream -> http://localhost:5001/video_feed")
    print("  Alert  -> http://localhost:5001/latest_alert")
    print("  Status -> http://localhost:5001/status")
    app.run(host="0.0.0.0", port=5001, threaded=True, use_reloader=False)
