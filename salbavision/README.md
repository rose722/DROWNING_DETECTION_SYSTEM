# Salbavision — AI-Powered Drowning Detection System

A full-stack drowning detection platform combining a **Next.js web dashboard** with **Python AI detection scripts** that stream live annotated video, trigger siren alerts, and log incidents to Supabase.

---

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    SALBAVISION                          │
│                                                         │
│  ┌──────────────┐    ┌──────────────────────────────┐  │
│  │  IP Camera   │───▶│  Python Detection Script     │  │
│  │  (RTSP)      │    │  stream_bridge.py (YOLO)     │  │
│  └──────────────┘    │  rf_stream_bridge.py (RF)    │  │
│                      │  drowning.py (standalone)    │  │
│                      └──────────┬───────────────────┘  │
│                                 │                       │
│              ┌──────────────────┼──────────────────┐   │
│              ▼                  ▼                   ▼   │
│       MJPEG Stream         Siren Audio         Supabase │
│    localhost:5001/         (siren.mp3)         (alerts  │
│      video_feed                                 table)  │
│              │                                   │      │
│              └──────────────────┬────────────────┘      │
│                                 ▼                       │
│              ┌──────────────────────────────────────┐   │
│              │     Next.js Dashboard (port 3000)    │   │
│              │  /dashboard/admin/detection          │   │
│              │  /dashboard/admin/logs               │   │
│              │  /dashboard/admin/settings           │   │
│              └──────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
salbavision/
├── app/                        # Next.js App Router
│   ├── auth/                   # Auth pages (login, sign-up, etc.)
│   │   ├── login/
│   │   ├── sign-up/
│   │   ├── forgot-password/
│   │   └── ...
│   ├── dashboard/
│   │   └── admin/
│   │       ├── detection/      # Live video feed page
│   │       ├── logs/           # Incident history
│   │       └── settings/       # Camera & system settings
│   └── api/                    # Next.js API routes
│       ├── reset-password/
│       ├── send-otp/
│       └── verify-otp/
├── components/                 # Shared React components
├── lib/                        # Supabase client, utilities
│
├── stream_bridge.py            # YOLO-based detection + Flask stream
├── rf_stream_bridge.py         # Roboflow-based detection + Flask stream
├── drowning.py                 # Standalone viewer (no Flask/Supabase)
│
├── best.pt                     # YOLO model weights
├── siren.mp3                   # Alert audio
├── requirements.txt            # Python dependencies
├── proxy.ts                    # Next.js middleware
├── package.json
└── README.md
```

---

## Prerequisites

### Node.js (Dashboard)
- Node.js 18+
- npm

### Python (Detection Scripts)
- Python 3.9+
- See `requirements.txt`

---

## Setup

### 1. Environment Variables

Create a `.env.local` file in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
```

Both values are in your [Supabase project API settings](https://supabase.com/dashboard/project/_?showConnect=true).

### 2. Install Node Dependencies

```bash
npm install
```

### 3. Set Up Python Virtual Environment

It is recommended to use a virtual environment to keep Python dependencies isolated.
Full guide: [README-venv.md](README-venv.md)

```bash
python -m venv venv

# Windows (Command Prompt)
.\venv\Scripts\activate.bat

# Windows (PowerShell)
.\venv\Scripts\Activate.ps1

# Windows (Git Bash) / macOS / Linux
source venv/Scripts/activate
```

Then install dependencies:

```bash
pip install -r requirements.txt
```

For GPU acceleration (NVIDIA CUDA):

```bash
pip install inference-gpu opencv-python pillow flask supabase pygame
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
```

---

## Running the System

### Start the Next.js Dashboard

```bash
npm run dev
```

Dashboard available at `http://localhost:3000`

### Start a Detection Script

Pick one depending on your model:

| Script | Model | Use Case |
|---|---|---|
| `stream_bridge.py` | YOLO (`best.pt`) | Local model, no API key needed |
| `rf_stream_bridge.py` | Roboflow cloud | Cloud inference, easy model swap |
| `drowning.py` | Roboflow cloud | Standalone viewer, no dashboard |

```bash
# YOLO stream (default)
python stream_bridge.py

# Roboflow stream (integrates with dashboard)
python rf_stream_bridge.py

# Standalone viewer only
py drowning.py
```

Live stream available at `http://localhost:5001/video_feed`

---

## Detection Scripts

### `stream_bridge.py`
YOLO-based detection using a local `best.pt` model. Reads an RTSP camera, runs inference, serves an MJPEG stream via Flask, and logs drowning alerts to Supabase.

### `rf_stream_bridge.py`
Roboflow InferencePipeline version of `stream_bridge.py`. Same Flask/Supabase/siren integration, same suppression and alarm logic — just swaps local YOLO for Roboflow's hosted model.
Full docs: [README-rf_stream_bridge.md](README-rf_stream_bridge.md)

### `drowning.py`
Lightweight standalone script. Opens a local annotated window — no Flask, no Supabase, no siren. Use it for quick testing or offline demos.
Full docs: [README-drowning.md](README-drowning.md)

---

## Supabase Tables

| Table | Used by | Purpose |
|---|---|---|
| `alerts` | `stream_bridge.py`, `rf_stream_bridge.py` | Drowning alert records |
| `cameras` | `stream_bridge.py`, `rf_stream_bridge.py` | Camera registration |

---

## Dashboard Pages

| Route | Description |
|---|---|
| `/auth/login` | Admin login |
| `/dashboard/admin/detection` | Live camera feed with detection overlay |
| `/dashboard/admin/logs` | Incident and alert history |
| `/dashboard/admin/settings` | Camera and system configuration |

---

## Key Configuration

Settings are at the top of each Python script:

| Setting | Default | Description |
|---|---|---|
| `VIDEO_SOURCE` | RTSP URL | Camera or video file input |
| `RF_API_KEY` | — | Roboflow API key (`rf_stream_bridge.py`, `drowning.py`) |
| `RF_MODEL_ID` | — | Roboflow model ID |
| `DROWN_ALERT_THRESHOLD` | `0.50` | Minimum confidence to trigger alarm |
| `DOMINANCE_MARGIN` | `0.21` | How much drowning must exceed other classes |
| `ALARM_HOLD` | `5s` | How long alarm stays active after last detection |
| `ALERT_COOLDOWN` | `10s` | Minimum time between repeated alerts |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Dashboard | Next.js 16, React 19, Tailwind CSS, shadcn/ui |
| Auth | Supabase Auth |
| Database | Supabase (PostgreSQL) |
| Detection (YOLO) | Ultralytics YOLO, OpenCV |
| Detection (RF) | Roboflow Inference, OpenCV, PIL |
| Stream server | Flask (MJPEG) |
| Audio | pygame |
