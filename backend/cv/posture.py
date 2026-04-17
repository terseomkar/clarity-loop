"""
Posture and restlessness detection — Week 3 implementation target.

Planned approach (MediaPipe Pose, front-facing camera):
    Landmarks used (front view only):
        0  = nose
        7  = left ear,  8  = right ear
        11 = left shoulder, 12 = right shoulder
        23 = left hip,  24 = right hip

    Derived metrics (all relative/normalised — no absolute measurements):
        forward_head_lean  : nose.y - shoulder_mid.y  (drops → head forward)
        slump_score        : shoulder_mid.y - hip_mid.y  (compresses → slouching)
        shoulder_asymmetry : abs(left_shoulder.y - right_shoulder.y)
        head_tilt          : angle of ear-to-ear line vs horizontal

    Restlessness score:
        Rolling variance of (nose, shoulders, hips) positions over a
        5–10 s window (50–100 frames at ~10 fps).
        High variance → fidgeting. Low variance → settled.

Week 3 integration notes:
    - MediaPipe Pose can run client-side (JS @mediapipe/pose) to avoid sending
      raw frames to backend, keeping bandwidth low.
    - If run server-side: `import mediapipe as mp; mp.solutions.pose.Pose()`
    - Landmark coordinates are normalised [0,1] relative to frame size.
    - Only need visibility > 0.5 for each landmark before using it.
"""

from collections import deque
import numpy as np


class PostureDetector:
    """Stub — full implementation in Week 3."""

    WINDOW_FRAMES = 75  # ~5–10 s at 10 fps

    def __init__(self):
        self._history: deque = deque(maxlen=self.WINDOW_FRAMES)

    def push_landmarks(self, landmarks: dict) -> dict:
        """
        Accept a dict of {landmark_id: {x, y, z, visibility}} from MediaPipe Pose.
        Week 3: compute posture metrics and restlessness score here.
        """
        return {
            "forward_head_lean": None,
            "slump_score": None,
            "shoulder_asymmetry": None,
            "head_tilt_deg": None,
            "restlessness": None,
            "signal_quality": "not_implemented",
        }
