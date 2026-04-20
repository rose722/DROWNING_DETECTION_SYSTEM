# drowning.py — Standalone Detection Viewer

Lightweight script that runs the Roboflow drowning detection model and shows a live annotated window on your screen. No Flask server, no Supabase, no siren — just the raw detection output.

Use this to:
- Test the model on a new video or camera feed
- Demo detection offline without running the full system
- Debug inference output before integrating with `rf_stream_bridge.py`

---

## Requirements

- Python 3.9+
- Dependencies:

```bash
pip install inference opencv-python pillow
```

GPU (optional, faster inference):

```bash
pip install inference-gpu
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

---

## Run

```bash
py drowning.py
```

A window titled **"Drowning Detection"** will open showing the annotated feed.
Press `q` in the window to stop.

---

## Configuration

Edit the constants at the top of `drowning.py`:

```python
RF_API_KEY   = "your_roboflow_api_key"
RF_MODEL_ID  = "workspace/version"

# Pick one:
VIDEO_SOURCE = 0                                       # default webcam
VIDEO_SOURCE = "rtsp://user:pass@192.168.x.x/stream1" # IP camera
VIDEO_SOURCE = r"C:\path\to\video.mp4"                # local file

MAX_FPS = 60
```

### Getting your Roboflow credentials
- **API key** — Roboflow dashboard > Settings > API Keys
- **Model ID** — shown in the URL of your model page, format: `workspace-name/version-number`

---

## Detection Classes

| Class | Box Color |
|---|---|
| `drowning` | Red |
| `out of water` | Green |
| `swimming` | Purple |

Each box shows the class name and confidence score (e.g., `drowning (0.87)`).

---

## How It Works

1. `InferencePipeline.init()` connects to the Roboflow API and starts pulling frames from `VIDEO_SOURCE`.
2. For each frame, `handle_prediction()` is called with the raw prediction dict and the BGR numpy frame.
3. Bounding boxes and labels are drawn using PIL (better font rendering than OpenCV text).
4. The annotated frame is shown via `cv2.imshow()`.

---

## Difference from `rf_stream_bridge.py`

| Feature | `drowning.py` | `rf_stream_bridge.py` |
|---|---|---|
| Local display window | Yes | No |
| Flask MJPEG stream | No | Yes (`/video_feed`) |
| Supabase alert logging | No | Yes |
| Siren audio | No | Yes |
| Drowning suppression logic | No | Yes |
| Dashboard integration | No | Yes |

Use `drowning.py` for local testing. Use `rf_stream_bridge.py` for the live system.
