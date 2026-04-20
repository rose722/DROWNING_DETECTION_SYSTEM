# rf_stream_bridge.py — Roboflow Stream Bridge

Roboflow-powered version of `stream_bridge.py`. Uses Roboflow's `InferencePipeline` instead of a local YOLO model while keeping the same Flask MJPEG stream, Supabase alert logging, siren audio, and suppression logic.

Integrated from the `drowning-example.py` approach (capstone-pycharm) into the Salbavision stream bridge architecture.

---

## Requirements

- Python 3.9+

```bash
pip install -r requirements.txt
```

GPU (optional):

```bash
pip install inference-gpu
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

---

## Run

```bash
python rf_stream_bridge.py
```

| Endpoint | URL |
|---|---|
| Live MJPEG stream | `http://localhost:5001/video_feed` |
| Latest alert (JSON) | `http://localhost:5001/latest_alert` |
| List cameras | `GET http://localhost:5001/api/cameras` |
| Add/update camera | `POST http://localhost:5001/api/cameras` |
| Delete camera | `DELETE http://localhost:5001/api/cameras/<id>` |

The Next.js dashboard at `http://localhost:3000` reads `/video_feed` on the detection page.

---

## Configuration

Edit the constants at the top of `rf_stream_bridge.py`:

### Roboflow

```python
RF_API_KEY  = "your_roboflow_api_key"
RF_MODEL_ID = "workspace/version"
```

- **API key** — Roboflow dashboard > Settings > API Keys
- **Model ID** — URL of your model page, format: `workspace-name/version-number`

### Video source

```python
VIDEO_SOURCE = "rtsp://user:pass@192.168.x.x/stream1"  # IP camera (default)
VIDEO_SOURCE = 0                                         # webcam
VIDEO_SOURCE = r"C:\path\to\video.mp4"                  # local file
```

### Detection thresholds

```python
DROWN_ALERT_THRESHOLD = 0.50   # minimum confidence to trigger alarm
DROWN_DRAW_THRESHOLD  = 0.40   # minimum confidence to draw drowning box
OUT_DRAW_THRESHOLD    = 0.45
SWIM_DRAW_THRESHOLD   = 0.45
DOMINANCE_MARGIN      = 0.21   # drowning must exceed others by this margin
HARD_SUPPRESS_MARGIN  = 0.05   # suppress drowning if out/swim is within this margin
```

### Alarm timing

```python
STATE_HISTORY_LEN     = 12     # frames to keep in history window
REQUIRED_DROWN_FRAMES = 2      # drowning frames needed in history before alarm
ALARM_HOLD            = 5      # seconds alarm stays active after last detection
ALERT_COOLDOWN        = 10     # seconds before a new alert can be logged
```

### Supabase

```python
SUPABASE_URL = "https://your-project.supabase.co"
SUPABASE_KEY = "your_supabase_anon_key"
```

---

## Detection Logic

### Drowning suppression

To reduce false positives, a drowning detection is only accepted when **all three** conditions pass:

1. Drowning confidence ≥ `DROWN_ALERT_THRESHOLD`
2. No strong out-of-water or swimming detection within `HARD_SUPPRESS_MARGIN` of drowning confidence
3. Drowning confidence leads both other classes by at least `DOMINANCE_MARGIN`

### Scene state

Each frame is classified into one of four states:

| State | Condition |
|---|---|
| `DROWNING` | Passes suppression check |
| `OUT` | Out-of-water confidence ≥ threshold and dominant |
| `SWIMMING` | Swimming confidence ≥ threshold |
| `UNCERTAIN` | No class meets its threshold |

When the scene is `OUT` or `SWIMMING`, any `DROWNING` entries are immediately removed from history to prevent stale drowning counts from triggering a false alarm.

### Alarm

The alarm fires when:
- Current scene state is `DROWNING`
- `DROWNING` appears ≥ `REQUIRED_DROWN_FRAMES` times in the recent history window
- The alarm is not already active
- At least `ALERT_COOLDOWN` seconds have passed since the last alert

On alarm:
- Siren plays (`siren.mp3` via pygame)
- Alert is inserted into Supabase `alerts` table
- `alarm_active = True`

The alarm auto-clears after `ALARM_HOLD` seconds if the scene is no longer `DROWNING`.

---

## Supabase Schema

The script inserts into two tables:

### `alerts`

| Column | Type | Description |
|---|---|---|
| `camera_id` | text | Always `"CCTV1"` |
| `alert_message` | text | e.g. `"Drowning Detected"` |
| `status` | text | `"ongoing"` |
| `confidence` | float | Highest drowning confidence in frame |
| `alert_time` | timestamp | ISO 8601 string |

### `cameras`

| Column | Type | Description |
|---|---|---|
| `id` | text | Camera identifier |
| `rtsp_url` | text | Source URL |
| `is_active` | boolean | Whether camera is enabled |
| `name` | text | Display name |

---

## Difference from `stream_bridge.py`

| Feature | `stream_bridge.py` | `rf_stream_bridge.py` |
|---|---|---|
| Inference engine | YOLO (`best.pt`) | Roboflow InferencePipeline |
| Model file needed | Yes (`best.pt`) | No |
| API key needed | No | Yes (Roboflow) |
| Flask stream | Yes | Yes |
| Supabase logging | Yes | Yes |
| Siren audio | Yes | Yes |
| Suppression logic | Yes | Yes (identical) |
| Bounding box drawing | OpenCV | PIL (smoother text) |

Both scripts expose the same Flask endpoints and write to the same Supabase tables — they can be swapped without changing the dashboard.

---

## Difference from `drowning.py`

| Feature | `drowning.py` | `rf_stream_bridge.py` |
|---|---|---|
| Local display window | Yes | No |
| Flask MJPEG stream | No | Yes |
| Supabase logging | No | Yes |
| Siren audio | No | Yes |
| Suppression logic | No | Yes |
| Dashboard integration | No | Yes |
