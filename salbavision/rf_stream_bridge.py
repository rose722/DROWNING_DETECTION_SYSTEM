# =============================================================================
# rf_stream_bridge.py
# Roboflow Stream Bridge for Salbavision
# =============================================================================
#
# Drop-in replacement / companion for stream_bridge.py.
# Uses Roboflow InferencePipeline instead of YOLO for inference.
# Keeps the same Flask MJPEG feed, Supabase alerts, and siren logic.
#
# REQUIREMENTS
#   pip install inference opencv-python pillow flask supabase pygame
#   (GPU) pip install inference-gpu + PyTorch with CUDA
#
# RUN
#   python rf_stream_bridge.py
#   Stream → http://localhost:5001/video_feed
#   Alert  → http://localhost:5001/latest_alert
#
# =============================================================================

import os
import signal
import time
import threading
from collections import deque

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
RF_MODEL_ID = "aqw3rfaq3wcqrq2r/9"

# --- Video source ---
# 0 = webcam | "rtsp://..." = IP camera | r"C:\path\to\video.mp4" = file
# VIDEO_SOURCE = "rtsp://awts11:12345678@192.180.100.30:554/stream1"
# VIDEO_SOURCE = "rtsp://eirmonpaculan11%40gmail.com:KURw%25DaeM7dB08T7f4Cd@192.168.0.112:554/stream2"
#VIDEO_SOURCE = r"C:\dev\freelance_systems\salbavision\videos\IMG_1205.MOV"
MAX_FPS = 15

# --- Supabase ---
SUPABASE_URL = "https://yzohitznmgtzdkzyoztf.supabase.co"
SUPABASE_KEY = "sb_secret_Q8_z2vsv5-x-KxSk25AJjQ_ONbMzgKF"

# --- Audio ---
AUDIO_ENABLED = True
SIREN_FILE    = "siren.mp3"

# --- Detection thresholds (mirrors stream_bridge.py) ---
DROWN_ALERT_THRESHOLD = 0.50
DROWN_DRAW_THRESHOLD  = 0.40
OUT_DRAW_THRESHOLD    = 0.45
SWIM_DRAW_THRESHOLD   = 0.45
DOMINANCE_MARGIN      = 0.21
HARD_SUPPRESS_MARGIN  = 0.05

STATE_HISTORY_LEN     = 12
REQUIRED_DROWN_FRAMES = 2
ALARM_HOLD            = 5
ALERT_COOLDOWN        = 10

# --- RTSP pre-check timeout (seconds) ---
RTSP_CHECK_TIMEOUT = 8

# --- Pipeline retry delay on source error (seconds) ---
PIPELINE_RETRY_DELAY = 10

# --- Display / stream (overridden by hardware profile below) ---
FONT_PATH = "C:/Windows/Fonts/arial.ttf"

# =============================================================================
# HARDWARE PROFILE  — auto-detected at startup
# Sets MAX_FPS / DISPLAY_WIDTH / JPEG_QUALITY based on CPU vs GPU
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
    # GPU — higher throughput
    MAX_FPS       = 15
    DISPLAY_WIDTH = 960
    JPEG_QUALITY  = 80
    print(f"[HW] GPU detected: {GPU_NAME} — high-performance profile")
    os.environ["CUDA_VISIBLE_DEVICES"] = "0"
    os.environ["ONNXRUNTIME_EXECUTION_PROVIDERS"] = (
        "CUDAExecutionProvider,CPUExecutionProvider"
    )
else:
    # CPU — conservative profile to avoid overloading the machine
    MAX_FPS       = 8
    DISPLAY_WIDTH = 640
    JPEG_QUALITY  = 65
    print("[HW] No GPU — CPU profile (8 fps, 640px, q65)")

CLASS_COLORS_BGR = {
    "drowning":     (0, 0, 255),
    "out of water": (0, 255, 0),
    "swimming":     (255, 0, 127),
}

# =============================================================================
# RUNTIME STATE
# =============================================================================

processed_frame = None
latest_alert    = None
frame_lock      = threading.Lock()

state_history     = deque(maxlen=STATE_HISTORY_LEN)
alarm_active      = False
alarm_start_time  = 0
last_alert_time   = 0

# Pipeline lifecycle status — read by /status endpoint
PIPELINE_STATUS  = "starting"   # starting | running | error | stopped
PIPELINE_ERROR   = None         # last error message if status == error
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
    FONT = ImageFont.truetype(FONT_PATH, 20)
    FONT_SM = ImageFont.truetype(FONT_PATH, 16)
except OSError:
    FONT = ImageFont.load_default()
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
            "camera_id":    "CCTV1",
            "alert_message": label,
            "status":       "ongoing",
            "confidence":   confidence,
            "alert_time":   time.strftime("%Y-%m-%dT%H:%M:%S"),
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
# DRAWING  (PIL-based, from drowning-example.py approach)
# =============================================================================

def draw_predictions(frame: np.ndarray, predictions: list,
                     drown_candidate: bool) -> np.ndarray:
    """Draw bounding boxes and labels onto a BGR numpy frame via PIL."""
    pil = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil)

    for pred in predictions:
        if not isinstance(pred, dict):
            continue

        x, y = pred.get("x", 0), pred.get("y", 0)
        w, h = pred.get("width", 0), pred.get("height", 0)
        cls  = pred.get("class", "")
        conf = pred.get("confidence", 0.0)

        # Suppress drawing drowning box if not a valid drowning candidate
        if cls == "drowning" and not drown_candidate:
            continue

        # Confidence gate per class
        if cls == "drowning"     and conf < DROWN_DRAW_THRESHOLD: continue
        if cls == "out of water" and conf < OUT_DRAW_THRESHOLD:   continue
        if cls == "swimming"     and conf < SWIM_DRAW_THRESHOLD:  continue

        color_bgr = CLASS_COLORS_BGR.get(cls, (255, 255, 255))
        color_rgb = color_bgr[::-1]

        pt1 = (int(x - w / 2), int(y - h / 2))
        pt2 = (int(x + w / 2), int(y + h / 2))
        box_w = 8 if cls == "drowning" else 4
        draw.rectangle([pt1, pt2], outline=color_rgb, width=box_w)

        label = f"{cls.upper()} {conf * 100:.1f}%"
        tb = draw.textbbox((0, 0), label, font=FONT)
        tw, th = tb[2] - tb[0], tb[3] - tb[1]
        lx = pt1[0]
        ly = pt1[1] - th - 4 if pt1[1] - th - 4 >= 0 else pt1[1] + 4
        draw.rectangle([lx, ly, lx + tw + 6, ly + th + 4], fill=color_rgb)
        draw.text((lx + 3, ly + 2), label, font=FONT, fill="white")

    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def draw_status_overlay(frame: np.ndarray, scene_state: str,
                        best_drown: float, best_out: float, best_swim: float,
                        drown_count: int, out_count: int, swim_count: int) -> np.ndarray:
    """PIL text overlay — same font/style as drowning.py."""
    pil = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil)

    if alarm_active:
        status_text  = "DROWNING ALERT!"
        status_color = (255, 0, 0)
    elif scene_state == "DROWNING":
        status_text  = "POSSIBLE DROWNING"
        status_color = (255, 60, 0)
    elif scene_state == "OUT":
        status_text  = "PERSON OUT OF WATER"
        status_color = (255, 200, 0)
    elif scene_state == "SWIMMING":
        status_text  = "SWIMMING DETECTED"
        status_color = (0, 200, 0)
    else:
        status_text  = "SAFE / UNCERTAIN"
        status_color = (0, 180, 0)

    # Status badge
    tb = draw.textbbox((0, 0), status_text, font=FONT)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    draw.rectangle([10, 10, 10 + tw + 12, 10 + th + 8], fill=status_color)
    draw.text((16, 14), status_text, font=FONT, fill="white")

    # Confidence + history line
    info = (f"D={best_drown:.2f}  O={best_out:.2f}  S={best_swim:.2f}"
            f"    hist D={drown_count} O={out_count} S={swim_count}")
    tb2 = draw.textbbox((0, 0), info, font=FONT_SM)
    tw2, th2 = tb2[2] - tb2[0], tb2[3] - tb2[1]
    y2 = 10 + th + 8 + 6
    draw.rectangle([10, y2, 10 + tw2 + 12, y2 + th2 + 6], fill=(30, 30, 30))
    draw.text((16, y2 + 3), info, font=FONT_SM, fill="white")

    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


# =============================================================================
# ALARM LOGIC  (mirrors stream_bridge.py detect() logic)
# =============================================================================

def _process_alarm(scene_state: str, best_drown_conf: float,
                   drown_count: int):
    global alarm_active, alarm_start_time, last_alert_time

    now = time.time()

    if (
        scene_state == "DROWNING"
        and drown_count >= REQUIRED_DROWN_FRAMES
        and not alarm_active
        and (now - last_alert_time) >= ALERT_COOLDOWN
    ):
        alarm_active     = True
        alarm_start_time = now
        last_alert_time  = now
        play_siren()
        log_alert(best_drown_conf if best_drown_conf > 0 else 0.50)
        print("DROWNING DETECTED")

    if alarm_active:
        if (now - alarm_start_time >= ALARM_HOLD) and scene_state != "DROWNING":
            alarm_active = False
            stop_siren()
            print("Alarm Cleared")


# =============================================================================
# PREDICTION CALLBACK  (called by InferencePipeline on every frame)
# =============================================================================

def handle_prediction(prediction_data, frame):
    global processed_frame, state_history

    # Unwrap Roboflow VideoFrame
    if hasattr(frame, "image"):
        frame = frame.image
    if not isinstance(frame, np.ndarray):
        return

    predictions = prediction_data.get("predictions", [])

    # --- Confidence aggregation ---
    best_drown = best_out = best_swim = 0.0
    for pred in predictions:
        if not isinstance(pred, dict):
            continue
        cls  = pred.get("class", "")
        conf = pred.get("confidence", 0.0)
        if cls == "drowning":
            best_drown = max(best_drown, conf)
        elif cls == "out of water":
            best_out = max(best_out, conf)
        elif cls == "swimming":
            best_swim = max(best_swim, conf)

    # --- Strict drowning suppression (mirrors stream_bridge.py) ---
    drown_candidate = best_drown >= DROWN_ALERT_THRESHOLD

    if best_out >= OUT_DRAW_THRESHOLD and best_out >= best_drown - HARD_SUPPRESS_MARGIN:
        drown_candidate = False
    if best_swim >= SWIM_DRAW_THRESHOLD and best_swim >= best_drown - HARD_SUPPRESS_MARGIN:
        drown_candidate = False
    if not (
        best_drown >= best_out  + DOMINANCE_MARGIN and
        best_drown >= best_swim + DOMINANCE_MARGIN
    ):
        drown_candidate = False

    # --- Scene state ---
    out_strong  = best_out  >= OUT_DRAW_THRESHOLD
    swim_strong = best_swim >= SWIM_DRAW_THRESHOLD

    if drown_candidate:
        scene_state = "DROWNING"
    elif out_strong and best_out >= best_swim:
        scene_state = "OUT"
    elif swim_strong:
        scene_state = "SWIMMING"
    else:
        scene_state = "UNCERTAIN"

    state_history.append(scene_state)

    # Fast-clear false drowning history when out/swimming is dominant
    if scene_state in ("OUT", "SWIMMING"):
        filtered = [s for s in state_history if s != "DROWNING"]
        state_history.clear()
        state_history.extend(filtered)

    drown_count = sum(1 for s in state_history if s == "DROWNING")
    out_count   = sum(1 for s in state_history if s == "OUT")
    swim_count  = sum(1 for s in state_history if s == "SWIMMING")

    # --- Alarm ---
    _process_alarm(scene_state, best_drown, drown_count)

    # --- Draw ---
    display = draw_predictions(frame.copy(), predictions, drown_candidate)
    display = draw_status_overlay(display, scene_state,
                                  best_drown, best_out, best_swim,
                                  drown_count, out_count, swim_count)
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
    with _status_lock:
        return jsonify({
            "pipeline": PIPELINE_STATUS,
            "error":    PIPELINE_ERROR,
            "source":   str(VIDEO_SOURCE),
            "hardware": "GPU" if HAS_GPU else "CPU",
            "fps":      MAX_FPS,
            "width":    DISPLAY_WIDTH,
        })


# --- Camera management (same as stream_bridge.py) ---

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
    """Quick cv2 probe to see if an RTSP source is reachable before
    handing it to InferencePipeline (which blocks indefinitely on hang)."""
    if not str(url).startswith("rtsp://"):
        return True   # files and webcams don't need pre-checking
    try:
        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout * 1000)
        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, timeout * 1000)
        ok = cap.isOpened()
        cap.release()
        return ok
    except Exception:
        return False


_pipeline_ref = None   # module-level so _shutdown can reach it

def _run_pipeline():
    """Runs in a background daemon thread so Flask starts immediately.
    Retries automatically if the source is temporarily unavailable."""
    global PIPELINE_STATUS, PIPELINE_ERROR, _pipeline_ref

    while True:
        # --- RTSP pre-check ---
        if str(VIDEO_SOURCE).startswith("rtsp://"):
            print(f"[PIPELINE] Checking source reachability ({RTSP_CHECK_TIMEOUT}s timeout)...")
            if not _check_rtsp(VIDEO_SOURCE):
                with _status_lock:
                    PIPELINE_STATUS = "error"
                    PIPELINE_ERROR  = f"Source unreachable: {VIDEO_SOURCE}"
                print(f"[PIPELINE] Source unreachable — retrying in {PIPELINE_RETRY_DELAY}s")
                time.sleep(PIPELINE_RETRY_DELAY)
                continue
            print("[PIPELINE] Source reachable")

        # --- Init + start ---
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
            pipeline.join()   # blocks until pipeline stops naturally

        except Exception as e:
            with _status_lock:
                PIPELINE_STATUS = "error"
                PIPELINE_ERROR  = str(e)
            print(f"[PIPELINE] Error: {e} — retrying in {PIPELINE_RETRY_DELAY}s")

        time.sleep(PIPELINE_RETRY_DELAY)


if __name__ == "__main__":
    register_camera()

    # Ctrl+C / SIGTERM — Flask + pipeline thread both need to die.
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

    # Pipeline runs in background — Flask starts immediately regardless
    t = threading.Thread(target=_run_pipeline, daemon=True)
    t.start()

    print("[SERVER] Running")
    print("  Stream → http://localhost:5001/video_feed")
    print("  Alert  → http://localhost:5001/latest_alert")
    print("  Status → http://localhost:5001/status")
    app.run(host="0.0.0.0", port=5001, threaded=True, use_reloader=False)
