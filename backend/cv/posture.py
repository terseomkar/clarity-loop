"""
Posture and restlessness detection — Week 3.

Pipeline (matches the plan's MediaPipe Pose, front-facing approach):

    Frontend (@mediapipe/pose in the browser) runs the model and ships
    only the seven landmarks we care about over WebSocket as
    { type: "pose_data", landmarks: { "0": {x,y,visibility}, ... } }.

    Backend collects landmark snapshots in a rolling window and derives:

        forward_head_lean   nose.y minus shoulder midpoint y
                            (less negative / more positive → head dropping forward)
        slump_score         hip_mid.y minus shoulder_mid.y
                            (smaller → chest compressing / slouching)
        shoulder_asymmetry  |L_shoulder.y - R_shoulder.y|  (bracing / hiked shoulder)
        head_tilt_deg       angle of the ear-to-ear line vs horizontal
        restlessness        mean per-coord stdev of (nose + shoulders + hips)
                            over the rolling window, scaled into [0, 1]

    All values are normalised image-space (no calibration needed — we only
    care about *change*, consistent with the "Ambiguity as Design" principle
    and the validated rule of trusting deltas over absolutes).

Visibility gate: landmarks below MIN_VISIBILITY are dropped. If hips drop
out of frame (common at typical webcam distance) we degrade to upper-body
metrics rather than refusing entirely — signal_quality becomes
"upper_body_only" and slump_score is None.

RESTLESS_SAT is the saturation point in image-space stdev — the value at
which restlessness clamps to 1.0. Will be tuned during live validation.
"""

from collections import deque
import math
import statistics

# MediaPipe Pose landmark indices (front-view)
NOSE           = 0
LEFT_EAR       = 7
RIGHT_EAR      = 8
LEFT_SHOULDER  = 11
RIGHT_SHOULDER = 12
LEFT_HIP       = 23
RIGHT_HIP      = 24


class PostureDetector:
    WINDOW_FRAMES  = 30      # ~6 s at ~5 fps client-side pose updates
    MIN_VISIBILITY = 0.5
    RESTLESS_SAT   = 0.04    # image-space stdev at which restlessness saturates

    def __init__(self):
        self._history: deque = deque(maxlen=self.WINDOW_FRAMES)
        self._last_metrics: dict = self._empty("waiting")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def push_landmarks(self, landmarks: dict | None) -> dict:
        """
        Accept {landmark_id: {x, y, visibility}} from frontend MediaPipe Pose.
        Returns the current posture snapshot (also retrievable via latest()).
        """
        if not landmarks:
            self._last_metrics = self._empty("no_pose")
            return self._last_metrics

        nose       = self._get(landmarks, NOSE)
        l_ear      = self._get(landmarks, LEFT_EAR)
        r_ear      = self._get(landmarks, RIGHT_EAR)
        l_shoulder = self._get(landmarks, LEFT_SHOULDER)
        r_shoulder = self._get(landmarks, RIGHT_SHOULDER)
        l_hip      = self._get(landmarks, LEFT_HIP)
        r_hip      = self._get(landmarks, RIGHT_HIP)

        upper_ok = nose and l_shoulder and r_shoulder
        full_ok  = upper_ok and l_hip and r_hip

        if not upper_ok:
            self._last_metrics = self._empty("poor")
            return self._last_metrics

        shoulder_mid_y = (l_shoulder["y"] + r_shoulder["y"]) / 2.0

        forward_head_lean  = nose["y"] - shoulder_mid_y
        shoulder_asymmetry = abs(l_shoulder["y"] - r_shoulder["y"])

        head_tilt_deg = None
        if l_ear and r_ear:
            # Some webcams (esp. built-in laptop cams) mirror the feed before
            # MediaPipe sees it, which flips left/right in image space.  Using
            # abs() for the horizontal separation makes the formula robust to
            # either convention — y-difference still carries the tilt direction.
            # Convention with raw (unmirrored) feed: positive = tilt toward your
            # own left shoulder (anatomical left ear drops).
            dx = abs(l_ear["x"] - r_ear["x"])
            dy = l_ear["y"] - r_ear["y"]
            head_tilt_deg = math.degrees(math.atan2(dy, dx))

        slump_score = None
        if full_ok:
            hip_mid_y = (l_hip["y"] + r_hip["y"]) / 2.0
            slump_score = hip_mid_y - shoulder_mid_y

        # Restlessness sample: positions of (nose + shoulders [+ hips if visible])
        if full_ok:
            sample = self._flatten([nose, l_shoulder, r_shoulder, l_hip, r_hip])
        else:
            sample = self._flatten([nose, l_shoulder, r_shoulder])

        # If the visible-landmark set changed (hips left frame), reset the
        # history so we don't compute variance over mismatched dimensions.
        if self._history and len(self._history[-1]) != len(sample):
            self._history.clear()
        self._history.append(sample)

        self._last_metrics = {
            "forward_head_lean":  round(forward_head_lean, 4),
            "slump_score":        round(slump_score, 4) if slump_score is not None else None,
            "shoulder_asymmetry": round(shoulder_asymmetry, 4),
            "head_tilt_deg":      round(head_tilt_deg, 2) if head_tilt_deg is not None else None,
            "restlessness":       self._compute_restlessness(),
            "signal_quality":     "ok" if full_ok else "upper_body_only",
        }
        return self._last_metrics

    def latest(self) -> dict:
        return self._last_metrics

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _get(self, landmarks: dict, idx: int) -> dict | None:
        # Keys arrive as strings from JSON; tolerate both.
        lm = landmarks.get(str(idx)) or landmarks.get(idx)
        if not lm:
            return None
        if lm.get("visibility", 0.0) < self.MIN_VISIBILITY:
            return None
        return lm

    @staticmethod
    def _flatten(points: list[dict]) -> list[float]:
        out: list[float] = []
        for p in points:
            out.append(p["x"])
            out.append(p["y"])
        return out

    def _compute_restlessness(self) -> float | None:
        """
        Mean per-coordinate population stdev of (nose + shoulders + hips)
        across the rolling window, scaled to [0, 1] with saturation at
        RESTLESS_SAT.  Needs ≥5 samples (~1 s) to be meaningful.
        """
        if len(self._history) < 5:
            return None
        cols = list(zip(*self._history))
        stds = [statistics.pstdev(col) for col in cols]
        mean_std = sum(stds) / len(stds)
        return round(min(mean_std / self.RESTLESS_SAT, 1.0), 3)

    @staticmethod
    def _empty(quality: str) -> dict:
        return {
            "forward_head_lean":  None,
            "slump_score":        None,
            "shoulder_asymmetry": None,
            "head_tilt_deg":      None,
            "restlessness":       None,
            "signal_quality":     quality,
        }
