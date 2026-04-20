import cv2
import time
import threading
from supabase import create_client, Client
import pygame
from collections import deque
from flask import Flask, Response, jsonify
from ultralytics import YOLO

app = Flask(__name__)
latest_frame = None
processed_frame = None
latest_alert = None
frame_lock = threading.Lock()

# ======================
# RTSP SETTINGS
# ======================
RTSP_URL = "rtsp://awts11:12345678@192.168.1.16:554/stream1"

# ======================
# SUPABASE CONFIG
# ======================
SUPABASE_URL = "https://yzohitznmgtzdkzyoztf.supabase.co"
SUPABASE_KEY = "sb_secret_Q8_z2vsv5-x-KxSk25AJjQ_ONbMzgKF"
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ======================
# AUDIO SETTINGS
# ======================
AUDIO_ENABLED = True
SIREN_FILE = "siren.mp3"

# ======================
# MODEL SETTINGS
# ======================
import os
MODEL_PATH = os.path.join(os.path.dirname(__file__), "best.pt")
MODEL_IMGSZ = 640

# ======================
# DETECTION SETTINGS
# ======================
BASE_CONF = 0.25
IOU_THRESH = 0.45
MIN_AREA_RATIO = 0.002

# Draw thresholds
DROWN_DRAW_THRESHOLD = 0.40
OUT_DRAW_THRESHOLD = 0.45
SWIM_DRAW_THRESHOLD = 0.45

# Alarm thresholds
DROWN_ALERT_THRESHOLD = 0.50
DOMINANCE_MARGIN = 0.21   # dapat mas mataas ang drowning kaysa ibang class
HARD_SUPPRESS_MARGIN = 0.05  # kung out/swim ay mas malapit o mas mataas, suppress drowning

# Temporal settings
STATE_HISTORY_LEN = 12
REQUIRED_DROWN_FRAMES = 2
CLEAR_FRAMES = 2
ALARM_HOLD = 5
ALERT_COOLDOWN = 10

# Performance settings
FRAME_SKIP = 1
DISPLAY_WIDTH = 960
JPEG_QUALITY = 80

# Runtime state
state_history = deque(maxlen=STATE_HISTORY_LEN)
alarm_active = False
alarm_start_time = 0
last_alert_time = 0
last_detection_debug = "No detections yet"

# ======================
# HELPERS
# ======================
def normalize_name(name):
    return str(name).strip().lower().replace("-", "_").replace(" ", "_")

def resize_for_display(frame, target_width=960):
    h, w = frame.shape[:2]
    if w <= target_width:
        return frame
    scale = target_width / w
    new_h = int(h * scale)
    return cv2.resize(frame, (target_width, new_h), interpolation=cv2.INTER_AREA)

def draw_box(frame, x1, y1, x2, y2, label, color):
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.58, 2)
    top_y = max(24, y1)
    cv2.rectangle(frame, (x1, top_y - th - 10), (x1 + tw + 10, top_y), color, -1)
    cv2.putText(
        frame,
        label,
        (x1 + 5, top_y - 5),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.58,
        (255, 255, 255),
        2
    )

def count_recent_states(history, state_name):
    return sum(1 for s in history if s == state_name)

def find_class_id(model_names, candidates):
    for cls_id, cls_name in model_names.items():
        norm = normalize_name(cls_name)
        for cand in candidates:
            if norm == normalize_name(cand):
                return int(cls_id)
    return None

def log_alert(confidence, label="Drowning Detected"):
    global latest_alert
    try:
        # Insert alert into Supabase 'alerts' table
        data = {
            "camera_id": "CCTV1",
            "alert_message": label,
            "status": "ongoing",
            "confidence": confidence,
            "alert_time": time.strftime("%Y-%m-%dT%H:%M:%S")
        }
        res = supabase.table("alerts").insert(data).execute()
        if res.get("status_code") not in (200, 201):
            print("Supabase DB ERROR:", res)
    except Exception as e:
        print("Supabase DB ERROR:", e)

    latest_alert = {
        "message": label,
        "confidence": round(confidence * 100, 1),
        "timestamp": time.time()
    }

# ======================
# AUDIO INIT
# ======================
if AUDIO_ENABLED:
    try:
        pygame.mixer.pre_init(44100, -16, 2, 2048)
        pygame.mixer.init()
        pygame.mixer.music.load(SIREN_FILE)
        print("✅ Siren loaded")
    except Exception as e:
        AUDIO_ENABLED = False
        print("⚠ Audio disabled:", e)

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

# ======================
# LOAD MODEL
# ======================
print("Loading YOLO model...")
model = YOLO(MODEL_PATH)
print("MODEL LOADED:", model.names)

# ======================
# CLASS MAPPING
# ======================
DROWNING_CLASS = find_class_id(model.names, ["drowning"])
OUT_CLASS = find_class_id(model.names, [
    "person_out_of_water",
    "person out of water",
    "out_of_water",
    "out of water"
])
SWIMMING_CLASS = find_class_id(model.names, ["swimming"])

if DROWNING_CLASS is None:
    DROWNING_CLASS = 0
if OUT_CLASS is None:
    OUT_CLASS = 1
if SWIMMING_CLASS is None:
    SWIMMING_CLASS = 2

print("FINAL CLASS MAP:")
print("  DROWNING_CLASS =", DROWNING_CLASS)
print("  OUT_CLASS      =", OUT_CLASS)
print("  SWIMMING_CLASS =", SWIMMING_CLASS)

# ======================
# RTSP CAPTURE THREAD
# ======================
def capture():
    global latest_frame

    while True:
        cap = cv2.VideoCapture(RTSP_URL, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        if not cap.isOpened():
            print("❌ Cannot connect to RTSP camera")
            time.sleep(2)
            continue

        print("📡 RTSP Camera Connected")

        while True:
            ret, frame = cap.read()

            if not ret:
                print("⚠ RTSP disconnected. Reconnecting...")
                cap.release()
                time.sleep(1)
                break

            with frame_lock:
                latest_frame = frame.copy()

# ======================
# DETECTION THREAD
# ======================
def detect():
    global processed_frame, alarm_active, alarm_start_time
    global last_alert_time, last_detection_debug

    print("🔍 Detection Started")
    counter = 0

    while True:
        with frame_lock:
            frame = None if latest_frame is None else latest_frame.copy()

        if frame is None:
            time.sleep(0.01)
            continue

        counter += 1
        display_frame = frame.copy()

        if counter % FRAME_SKIP != 0:
            processed_frame = resize_for_display(display_frame, DISPLAY_WIDTH)
            continue

        h, w = frame.shape[:2]
        frame_area = max(1, h * w)

        try:
            results = model.predict(
                source=frame,
                imgsz=MODEL_IMGSZ,
                conf=BASE_CONF,
                iou=IOU_THRESH,
                verbose=False
            )
        except Exception as e:
            cv2.putText(
                display_frame,
                f"MODEL ERROR: {e}",
                (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 0, 255),
                2
            )
            processed_frame = resize_for_display(display_frame, DISPLAY_WIDTH)
            time.sleep(0.05)
            continue

        best_drown_conf = 0.0
        best_out_conf = 0.0
        best_swim_conf = 0.0

        raw_boxes = []
        detection_strings = []

        for r in results:
            if r.boxes is None:
                continue

            for b in r.boxes:
                cls = int(b.cls[0])
                conf = float(b.conf[0])
                x1, y1, x2, y2 = map(int, b.xyxy[0])

                bw = max(1, x2 - x1)
                bh = max(1, y2 - y1)
                area_ratio = (bw * bh) / frame_area

                if area_ratio < MIN_AREA_RATIO:
                    continue

                class_name = normalize_name(model.names.get(cls, str(cls)))
                detection_strings.append(f"{class_name}:{conf:.2f}")
                raw_boxes.append((x1, y1, x2, y2, cls, conf))

                if cls == DROWNING_CLASS:
                    best_drown_conf = max(best_drown_conf, conf)
                elif cls == OUT_CLASS:
                    best_out_conf = max(best_out_conf, conf)
                elif cls == SWIMMING_CLASS:
                    best_swim_conf = max(best_swim_conf, conf)

        if detection_strings:
            last_detection_debug = " | ".join(detection_strings[:6])
        else:
            last_detection_debug = "No raw detections"

        # ======================
        # STRICT DROWNING SUPPRESSION
        # ======================
        drown_candidate = best_drown_conf >= DROWN_ALERT_THRESHOLD
        out_is_strong = best_out_conf >= OUT_DRAW_THRESHOLD
        swim_is_strong = best_swim_conf >= SWIM_DRAW_THRESHOLD

        # Huwag hayaang mag-drowning kung may malakas na swimming o out-of-water
        if out_is_strong and best_out_conf >= best_drown_conf - HARD_SUPPRESS_MARGIN:
            drown_candidate = False

        if swim_is_strong and best_swim_conf >= best_drown_conf - HARD_SUPPRESS_MARGIN:
            drown_candidate = False

        # Dapat dominant talaga ang drowning
        if not (
            best_drown_conf >= best_out_conf + DOMINANCE_MARGIN and
            best_drown_conf >= best_swim_conf + DOMINANCE_MARGIN
        ):
            drown_candidate = False

        # ======================
        # SCENE STATE
        # ======================
        if drown_candidate:
            scene_state = "DROWNING"
        elif out_is_strong and best_out_conf >= best_swim_conf:
            scene_state = "OUT"
        elif swim_is_strong:
            scene_state = "SWIMMING"
        else:
            scene_state = "UNCERTAIN"

        state_history.append(scene_state)

        drown_count = count_recent_states(state_history, "DROWNING")
        out_count = count_recent_states(state_history, "OUT")
        swim_count = count_recent_states(state_history, "SWIMMING")

        # kapag OUT o SWIMMING ang dominant, mabilis linisin ang false drowning history
        if scene_state in ["OUT", "SWIMMING"]:
            filtered = [s for s in state_history if s != "DROWNING"]
            state_history.clear()
            state_history.extend(filtered)
            drown_count = count_recent_states(state_history, "DROWNING")

        # ======================
        # ALARM LOGIC
        # ======================
        now = time.time()

        if (
            scene_state == "DROWNING" and
            drown_count >= REQUIRED_DROWN_FRAMES and
            not alarm_active and
            (now - last_alert_time) >= ALERT_COOLDOWN
        ):
            alarm_active = True
            alarm_start_time = now
            last_alert_time = now
            play_siren()
            log_alert(best_drown_conf if best_drown_conf > 0 else 0.50)
            print("🚨 DROWNING DETECTED")

        if alarm_active:
            # auto clear kapag hindi na dominant drowning
            if (now - alarm_start_time >= ALARM_HOLD) and scene_state != "DROWNING":
                alarm_active = False
                stop_siren()
                print("✅ Alarm Cleared")

        # ======================
        # DRAW BOXES
        # ======================
        for x1, y1, x2, y2, cls, conf in raw_boxes:
            label = None
            color = None

            # red box only kapag tunay na drowning candidate
            if cls == DROWNING_CLASS and conf >= DROWN_DRAW_THRESHOLD and drown_candidate:
                label = f"DROWNING {conf * 100:.1f}%"
                color = (0, 0, 255)

            elif cls == OUT_CLASS and conf >= OUT_DRAW_THRESHOLD:
                label = f"PERSON OUT OF WATER {conf * 100:.1f}%"
                color = (0, 215, 255)

            elif cls == SWIMMING_CLASS and conf >= SWIM_DRAW_THRESHOLD:
                label = f"SWIMMING {conf * 100:.1f}%"
                color = (0, 200, 0)

            if label is not None:
                draw_box(display_frame, x1, y1, x2, y2, label, color)

        # ======================
        # STATUS OVERLAY
        # ======================
        if alarm_active:
            status_text = "DROWNING ALERT!"
            status_color = (0, 0, 255)
        else:
            if scene_state == "DROWNING":
                status_text = "POSSIBLE DROWNING"
                status_color = (0, 100, 255)
            elif scene_state == "OUT":
                status_text = "PERSON OUT OF WATER"
                status_color = (0, 215, 255)
            elif scene_state == "SWIMMING":
                status_text = "SWIMMING DETECTED"
                status_color = (0, 255, 0)
            else:
                status_text = "SAFE / UNCERTAIN"
                status_color = (180, 255, 180)

        cv2.putText(
            display_frame,
            status_text,
            (20, 35),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.95,
            status_color,
            2
        )

        cv2.putText(
            display_frame,
            f"Drown={best_drown_conf:.2f} Out={best_out_conf:.2f} Swim={best_swim_conf:.2f}",
            (20, 68),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.65,
            (255, 255, 255),
            2
        )

        cv2.putText(
            display_frame,
            f"History D={drown_count} O={out_count} S={swim_count}",
            (20, 98),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.65,
            (255, 255, 0),
            2
        )

        cv2.putText(
            display_frame,
            f"Raw: {last_detection_debug[:110]}",
            (20, 128),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.52,
            (200, 200, 255),
            2
        )

        processed_frame = resize_for_display(display_frame, DISPLAY_WIDTH)

# ======================
# VIDEO STREAM API
# ======================
def generate():
    global processed_frame

    while True:
        if processed_frame is None:
            time.sleep(0.01)
            continue

        ret, buffer = cv2.imencode(
            ".jpg",
            processed_frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]
        )

        if not ret:
            continue

        frame_bytes = buffer.tobytes()

        yield (
            b'--frame\r\n'
            b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n'
        )

@app.route("/video_feed")
def video_feed():
    return Response(
        generate(),
        mimetype="multipart/x-mixed-replace; boundary=frame"
    )

@app.route("/latest_alert")
def latest_alert_api():
    return jsonify(latest_alert if latest_alert else {
        "message": None,
        "confidence": None,
        "timestamp": None
    })

# Camera management API endpoints for dashboard/settings
@app.route("/api/cameras", methods=["GET"])
def get_cameras():
    try:
        res = supabase.table("cameras").select("*").execute()
        return jsonify(res.data), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/cameras", methods=["POST"])
def add_camera():
    from flask import request
    try:
        data = request.json
        if not data or "id" not in data or "rtsp_url" not in data:
            return jsonify({"error": "Missing required fields"}), 400
        cam_data = {
            "id": data["id"],
            "rtsp_url": data["rtsp_url"],
            "is_active": data.get("is_active", True),
            "name": data.get("name", data["id"])
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

# ======================
# MAIN
# ======================
def register_camera():
    try:
        cam_id = "CCTV1"
        cam_data = {
            "id": cam_id,
            "rtsp_url": RTSP_URL,
            "is_active": True,
            "name": "CCTV Camera 1"
        }
        # Upsert camera (insert if not exists, update if exists)
        res = supabase.table("cameras").upsert(cam_data, on_conflict=["id"]).execute()
        print("Camera registered/updated in Supabase:", res)
    except Exception as e:
        print("Camera registration error:", e)

if __name__ == "__main__":
    register_camera()
    threading.Thread(target=capture, daemon=True).start()
    threading.Thread(target=detect, daemon=True).start()

    print("🚀 Server running")
    print("http://localhost:5001/video_feed")

    app.run(host="0.0.0.0", port=5001, threaded=True)
