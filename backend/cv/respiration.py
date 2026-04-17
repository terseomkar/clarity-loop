"""
Respiration rate detection — Week 2 implementation target.

Planned approach (from Respiration-Rate-Detection reference):
    1. Calibration phase: capture ~128 frames, run Eulerian Video Magnification
       (bandpass 0.1–1.0 Hz) to find the ROI with highest breathing motion.
    2. Measurement phase: crop to ROI, extract motion via pixel averaging
       (motion_extraction_method='average') or Lucas-Kanade optical flow.
    3. Lowpass filter the motion signal + peak detection → breaths per minute.

Week 2 integration notes:
    - The reference (Respiration-Rate-Detection/base.py) opens its own cv2.VideoCapture
      and runs a Qt GUI. For Clarity Loop we need to adapt it to:
        a) Accept frames pushed by the WebSocket (not pull from webcam directly), OR
        b) Run as a background thread with a shared frame queue.
    - The calibration buffer_target_length=128 frames at 10 fps ≈ 13 seconds.
      Plan: start calibration immediately when CV pipeline starts; results available
      before the user finishes the subjective input flow (~30–60 s).
    - Key files to port: transforms.py (EVM), tools.py (Benchmarker, reduce_bounding_box)
"""


class RespirationDetector:
    """Stub — full implementation in Week 2."""

    def __init__(self):
        self.calibrated = False
        self.rr_bpm: float | None = None

    def push_frame(self, frame) -> dict:
        """
        Accept a grayscale frame (numpy uint8 array) from the WebSocket frame queue.
        Returns current state dict.
        Week 2: replace stub with adapted RespiratoryMonitor logic.
        """
        return {
            "rr_bpm": self.rr_bpm,
            "calibrated": self.calibrated,
            "signal_quality": "not_implemented",
        }
