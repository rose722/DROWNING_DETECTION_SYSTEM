# =============================================================================
# rf_stream_low.py
# Roboflow Stream Bridge — Low-End / Potato-Laptop Edition
# =============================================================================
#
# Optimized for CPU-only machines (Intel HD Graphics, i5-6200U, 8 GB RAM).
# Key difference from rf_stream_delay.py:
#   - cv2 drawing instead of PIL (zero color conversions per frame)
#   - Resize BEFORE drawing (smaller canvas = faster boxes/text)
#   - Terminal profile selector (0 / 1 / 2) to tune for hardware
#
# Keeps: Flask MJPEG, Supabase alerts, siren, drowning confirmation.
#
# RUN
#   python rf_stream_low.py
#   Pick a profile at startup, then:
#     Stream -> http://localhost:5001/video_feed
#     Alert  -> http://localhost:5001/latest_alert
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
from supabase import create_client, Client

# =============================================================================
# CONFIG
# =============================================================================

RF_API_KEY  = os.getenv("RF_API_KEY", "")

# RF_MODEL_ID = "aqw3rfaq3wcqrq2r/9" # splashsafe yolov11 accurate
RF_MODEL_ID = os.getenv("RF_MODEL_ID", "aqw3rfaq3wcqrq2r/12")  # splashsafe yolov11 accurate
# RF_MODEL_ID = "aqw3rfaq3wcqrq2r-d778t/4" #akwatek yolov11 accurate
# RF_MODEL_ID = "aqw3rfaq3wcqrq2r-d778t/1" #akwatek rf-detr small
# RF_MODEL_ID = "iy-htoyq3tayectyk/5" # freelance rf-detr small

VIDEO_SOURCE = os.getenv("VIDEO_SOURCE", 0)  # RTSP URL or 0 for webcam

# --- Supabase ---
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

# --- Audio ---
AUDIO_ENABLED = True
SIREN_FILE    = "siren.mp3"

# --- Drowning confirmation ---
DROWNING_THRESHOLD   = 2.0
DETECTION_RESET_TIME = 3.0
HEARTBEAT_INTERVAL   = 5.0

# --- RTSP ---
RTSP_CHECK_TIMEOUT   = 8
PIPELINE_RETRY_DELAY = 10

# --- Colors (BGR for cv2) ---
CLASS_COLORS = {
    "drowning":     (0, 0, 255),
    "out of water": (0, 255, 0),
    "swimming":     (255, 0, 127),
}
WHITE = (255, 255, 255)

# =============================================================================
# PROFILE SELECTOR
# =============================================================================

PROFILES = {
    0: {
        "name":          "Potato",
        "max_fps":       3,
        "display_width": 480,
        "jpeg_quality":  60,
        "draw_text":     False,  # boxes only — no labels, no overlay text
        "font_scale":    0.45,
        "font_thick":    1,
        "box_thick":     2,
        "box_thick_d":   3,
    },
    1: {
        "name":          "Low",
        "max_fps":       5,
        "display_width": 640,
        "jpeg_quality":  70,
        "draw_text":     True,
        "font_scale":    0.50,
        "font_thick":    1,
        "box_thick":     2,
        "box_thick_d":   4,
    },
    2: {
        "name":          "Medium",
        "max_fps":       8,
        "display_width": 800,
        "jpeg_quality":  75,
        "draw_text":     True,
        "font_scale":    0.55,
        "font_thick":    2,
        "box_thick":     2,
        "box_thick_d":   4,
    },
}


def select_profile() -> dict:
    """Terminal prompt to pick a performance profile."""
    print()
    print("=" * 52)
    print("   PERFORMANCE PROFILE  (for low-end hardware)")
    print("=" * 52)
    for k, p in PROFILES.items():
        txt = "boxes+text" if p["draw_text"] else "boxes only"
        print(f"  {k}  {p['name']:8s}  {p['max_fps']}fps  {p['display_width']}px  q{p['jpeg_quality']}  {txt}")
    print("=" * 52)

    while True:
        choice = input("Select profile [0/1/2] (default 1): ").strip()
        if choice == "":
            return PROFILES[1]
        if choice in ("0", "1", "2"):
            return PROFILES[int(choice)]
        print("  Enter 0, 1, or 2")


PROFILE       = select_profile()
MAX_FPS       = PROFILE["max_fps"]
DISPLAY_WIDTH = PROFILE["display_width"]
JPEG_QUALITY  = PROFILE["jpeg_quality"]
DRAW_TEXT     = PROFILE["draw_text"]
FONT_SCALE    = PROFILE["font_scale"]
FONT_THICK    = PROFILE["font_thick"]
BOX_THICK     = PROFILE["box_thick"]
BOX_THICK_D   = PROFILE["box_thick_d"]
CV2_FONT      = cv2.FONT_HERSHEY_SIMPLEX

txt_mode = "boxes+text" if DRAW_TEXT else "boxes only"
print(f"[PROFILE] {PROFILE['name']} -- {MAX_FPS}fps, {DISPLAY_WIDTH}px, q{JPEG_QUALITY}, {txt_mode}")

# =============================================================================
# RUNTIME STATE
# =============================================================================

processed_jpeg  = None   # pre-encoded JPEG bytes (encode once, serve many)
latest_alert    = None
frame_lock      = threading.Lock()

drowning_start_time  = None
drowning_confirmed   = False
last_drowning_time   = None
last_heartbeat_time  = None
_state_lock          = threading.Lock()

PIPELINE_STATUS = "starting"
PIPELINE_ERROR  = None
_status_lock    = threading.Lock()

# =============================================================================
# FLASK / SUPABASE / AUDIO
# =============================================================================

app = Flask(__name__)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

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
        except Exception:
            pass


def stop_siren():
    if AUDIO_ENABLED:
        try:
            pygame.mixer.music.stop()
        except Exception:
            pass


def log_alert(confidence: float, label: str = "Drowning Detected"):
    global latest_alert
    try:
        supabase.table("alerts").insert({
            "camera_id":     "CCTV1",
            "alert_message": label,
            "status":        "ongoing",
            "confidence":    confidence,
            "alert_time":    time.strftime("%Y-%m-%dT%H:%M:%S"),
        }).execute()
    except Exception as e:
        print("Supabase alert error:", e)
    latest_alert = {
        "message":    label,
        "confidence": round(confidence * 100, 1),
        "timestamp":  time.time(),
    }


# =============================================================================
# DRAWING  (pure cv2 — zero color conversions)
# =============================================================================

def draw_frame(frame: np.ndarray, predictions: list) -> np.ndarray:
    """Draw boxes + labels + status overlay using cv2 only.
    No PIL, no BGR<->RGB conversions.  Operates directly on the numpy array
    so every saved cycle goes to inference instead of pixel shuffling.

    Resize happens FIRST so all drawing is on the smaller canvas.
    """
    h, w = frame.shape[:2]
    if w > DISPLAY_WIDTH:
        scale = DISPLAY_WIDTH / w
        frame = cv2.resize(frame, (DISPLAY_WIDTH, int(h * scale)),
                           interpolation=cv2.INTER_AREA)
        coord_scale = scale
    else:
        frame = frame.copy()   # only copy when no resize (resize already makes a new array)
        coord_scale = 1.0

    # --- Bounding boxes + labels ---
    for pred in predictions:
        if not isinstance(pred, dict):
            continue

        x  = pred.get("x", 0) * coord_scale
        y  = pred.get("y", 0) * coord_scale
        pw = pred.get("width", 0) * coord_scale
        ph = pred.get("height", 0) * coord_scale
        cls  = pred.get("class", "")
        conf = pred.get("confidence", 0.0)

        color = CLASS_COLORS.get(cls, WHITE)
        thick = BOX_THICK_D if cls == "drowning" else BOX_THICK

        x1, y1 = int(x - pw / 2), int(y - ph / 2)
        x2, y2 = int(x + pw / 2), int(y + ph / 2)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, thick)

        if DRAW_TEXT:
            label = f"{cls.upper()} {conf * 100:.1f}%"

            # Confirmation timer on drowning labels
            if cls == "drowning":
                with _state_lock:
                    dc = drowning_confirmed
                    ds = drowning_start_time
                    lh = last_heartbeat_time
                if dc:
                    if lh is not None:
                        nxt = HEARTBEAT_INTERVAL - (time.time() - lh)
                        label += f" [ACTIVE hb:{nxt:.1f}s]"
                    else:
                        label += " [CONFIRMED]"
                elif ds is not None:
                    elapsed = time.time() - ds
                    label += f" [{elapsed:.1f}s/{DROWNING_THRESHOLD}s]"

            (tw, th_txt), _ = cv2.getTextSize(label, CV2_FONT, FONT_SCALE, FONT_THICK)
            if y1 - th_txt - 8 >= 0:
                bg_y1 = y1 - th_txt - 8
                bg_y2 = y1
                txt_y = y1 - 4
            else:
                bg_y1 = y1
                bg_y2 = y1 + th_txt + 8
                txt_y = y1 + th_txt + 4
            cv2.rectangle(frame, (x1, bg_y1), (x1 + tw + 6, bg_y2), color, -1)
            cv2.putText(frame, label, (x1 + 3, txt_y), CV2_FONT,
                        FONT_SCALE, WHITE, FONT_THICK, cv2.LINE_AA)

    # --- Status overlay (only when text is enabled) ---
    if DRAW_TEXT:
        with _state_lock:
            dc = drowning_confirmed
            ds = drowning_start_time

        if dc:
            status_text  = "DROWNING ALERT!"
            status_color = (0, 0, 255)
        elif ds is not None:
            remaining    = max(0.0, DROWNING_THRESHOLD - (time.time() - ds))
            status_text  = f"CONFIRMING ({remaining:.1f}s)"
            status_color = (0, 140, 255)   # orange in BGR
        else:
            status_text  = "MONITORING"
            status_color = (0, 150, 0)

        s_scale = FONT_SCALE + 0.1
        s_thick = FONT_THICK + 1
        (sw, sh), _ = cv2.getTextSize(status_text, CV2_FONT, s_scale, s_thick)
        cv2.rectangle(frame, (10, 10), (10 + sw + 12, 10 + sh + 10), status_color, -1)
        cv2.putText(frame, status_text, (16, 10 + sh + 4), CV2_FONT,
                    s_scale, WHITE, s_thick, cv2.LINE_AA)

    return frame


# =============================================================================
# DROWNING CONFIRMATION
# =============================================================================

def process_drowning_detection(drowning_detected: bool, best_conf: float):
    global drowning_start_time, drowning_confirmed
    global last_drowning_time, last_heartbeat_time

    now = time.time()

    with _state_lock:
        if drowning_detected:
            last_drowning_time = now

            if drowning_start_time is None:
                drowning_start_time = now
                print(f"[DELAY] Drowning detected - confirming ({DROWNING_THRESHOLD}s)")
            else:
                dur = now - drowning_start_time
                if dur >= DROWNING_THRESHOLD:
                    if not drowning_confirmed:
                        drowning_confirmed  = True
                        last_heartbeat_time = now
                        play_siren()
                        log_alert(best_conf if best_conf > 0 else 0.50)
                        print(f"[DELAY] DROWNING CONFIRMED ({dur:.1f}s)")
                    else:
                        if (now - last_heartbeat_time) >= HEARTBEAT_INTERVAL:
                            last_heartbeat_time = now
                            log_alert(best_conf if best_conf > 0 else 0.50)
                            print(f"[DELAY] Heartbeat ({now - drowning_start_time:.0f}s)")
        else:
            if last_drowning_time is not None:
                gap = now - last_drowning_time
                if gap >= DETECTION_RESET_TIME:
                    if drowning_confirmed:
                        total = last_drowning_time - drowning_start_time
                        stop_siren()
                        print(f"[DELAY] Alarm cleared ({total:.1f}s)")
                    elif drowning_start_time is not None:
                        bl = last_drowning_time - drowning_start_time
                        print(f"[DELAY] Reset ({bl:.1f}s - below threshold)")

                    drowning_start_time = None
                    drowning_confirmed  = False
                    last_drowning_time  = None
                    last_heartbeat_time = None


# =============================================================================
# PREDICTION CALLBACK
# =============================================================================

def handle_prediction(prediction_data, frame):
    global processed_jpeg

    if hasattr(frame, "image"):
        frame = frame.image
    if not isinstance(frame, np.ndarray):
        return

    predictions = prediction_data.get("predictions", [])

    # Simple drowning check (no suppression)
    best_conf = 0.0
    drowning_detected = False
    for pred in predictions:
        if isinstance(pred, dict) and pred.get("class") == "drowning":
            drowning_detected = True
            best_conf = max(best_conf, pred.get("confidence", 0.0))

    process_drowning_detection(drowning_detected, best_conf)

    # cv2 draw (resize inside, before drawing) + encode JPEG once
    display = draw_frame(frame, predictions)
    ret, buf = cv2.imencode(".jpg", display,
                            [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])
    if ret:
        with frame_lock:
            processed_jpeg = buf.tobytes()


# =============================================================================
# FLASK ROUTES
# =============================================================================

def generate():
    interval = 1.0 / max(MAX_FPS, 1)  # pace output to profile FPS
    while True:
        with frame_lock:
            jpeg = processed_jpeg
        if jpeg is None:
            time.sleep(0.05)
            continue
        yield (b"--frame\r\n"
               b"Content-Type: image/jpeg\r\n\r\n"
               + jpeg + b"\r\n")
        time.sleep(interval)


@app.route("/video_feed")
def video_feed():
    return Response(generate(),
                    mimetype="multipart/x-mixed-replace; boundary=frame")


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
    confirming = round(time.time() - ds, 1) if ds and not dc else None
    with _status_lock:
        return jsonify({
            "pipeline":       PIPELINE_STATUS,
            "error":          PIPELINE_ERROR,
            "source":         str(VIDEO_SOURCE),
            "profile":        PROFILE["name"],
            "fps":            MAX_FPS,
            "width":          DISPLAY_WIDTH,
            "alarm_active":   dc,
            "confirming_for": confirming,
        })


@app.route("/api/cameras", methods=["GET"])
def get_cameras():
    try:
        return jsonify(supabase.table("cameras").select("*").execute().data), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/cameras", methods=["POST"])
def add_camera():
    try:
        data = request.json
        if not data or "id" not in data or "rtsp_url" not in data:
            return jsonify({"error": "Missing required fields"}), 400
        res = supabase.table("cameras").upsert({
            "id": data["id"], "rtsp_url": data["rtsp_url"],
            "is_active": data.get("is_active", True),
        }, on_conflict=["id"]).execute()
        return jsonify(res.data), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/cameras/<cam_id>", methods=["DELETE"])
def delete_camera(cam_id):
    try:
        return jsonify(supabase.table("cameras").delete().eq("id", cam_id).execute().data), 200
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


def _check_rtsp(url, timeout=RTSP_CHECK_TIMEOUT):
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
            print(f"[PIPELINE] Checking source ({RTSP_CHECK_TIMEOUT}s timeout)...")
            if not _check_rtsp(VIDEO_SOURCE):
                with _status_lock:
                    PIPELINE_STATUS = "error"
                    PIPELINE_ERROR  = f"Source unreachable: {VIDEO_SOURCE}"
                print(f"[PIPELINE] Unreachable - retrying in {PIPELINE_RETRY_DELAY}s")
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

    print(f"[SERVER] {PROFILE['name']} profile")
    print(f"  {MAX_FPS}fps | {DISPLAY_WIDTH}px | q{JPEG_QUALITY}")
    print(f"  Threshold : {DROWNING_THRESHOLD}s | Reset: {DETECTION_RESET_TIME}s | Heartbeat: {HEARTBEAT_INTERVAL}s")
    print("  Stream -> http://localhost:5001/video_feed")
    print("  Alert  -> http://localhost:5001/latest_alert")
    print("  Status -> http://localhost:5001/status")
    app.run(host="0.0.0.0", port=5001, threaded=True, use_reloader=False)
