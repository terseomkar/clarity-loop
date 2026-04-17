"""
Heart rate detection via remote photoplethysmography (rPPG).

Pipeline (Week 1 / reference-compatible):
    Browser extracts per-frame RGB averages from face forehead ROI.
    Sends buffer of (r[], g[], b[]) over WebSocket every ~1 second.
    This module:
        1. Builds 3×N matrix, normalises each channel.
        2. Runs JADE ICA to separate blood-volume-pulse signal from noise.
        3. Applies Hamming window, then selects the ICA component with
           the highest power-to-peak ratio (most periodic signal).
        4. FFT peak in the 45–200 BPM range → BPM.

Week 2 TODO:
    - Replace browser-side headtrackr ROI with MediaPipe Face Mesh
      (either JS via @mediapipe/face_mesh, or server-side via mediapipe Python).
    - Add bandpass filter (0.75–3.33 Hz) before ICA.
    - Add signal quality metric (SNR of dominant frequency vs neighbours).
"""

import numpy as np
from numpy import matrix

from .jade import run as jade_run


class HeartRateDetector:
    FPS: int = 15           # must match camera.js capture rate
    BPM_LOW: float = 0.75   # 45 BPM in Hz
    BPM_HIGH: float = 3.33  # 200 BPM in Hz
    MIN_BUFFER: int = 64    # samples needed before processing (~4 s at 15 fps)

    def process(self, r: list, g: list, b: list, buffer_window: int) -> dict:
        """
        Parameters
        ----------
        r, g, b       : per-frame channel averages (length = buffer_window)
        buffer_window : number of frames in the current buffer

        Returns
        -------
        dict with keys:
            bpm           : float | None
            spectrum      : list[float]  (power spectrum for frontend display)
            signal_quality: "ok" | "poor" | "insufficient_data" | "error"
        """
        if len(g) < self.MIN_BUFFER or buffer_window < self.MIN_BUFFER:
            return {"bpm": None, "spectrum": [], "signal_quality": "insufficient_data"}

        try:
            # Build 3×N float64 matrix (matches reference model.py exactly)
            X = np.ndarray(shape=(3, buffer_window), buffer=np.array([r, g, b]))
            X = self._normalize(X)

            ica_output = jade_run(X)          # shape: (buffer_window, 3)
            spectrum, bpm = self._extract(ica_output)

            quality = "ok" if (bpm and self.BPM_LOW * 60 <= bpm <= self.BPM_HIGH * 60) else "poor"
            return {"bpm": bpm, "spectrum": spectrum, "signal_quality": quality}

        except Exception as exc:
            return {"bpm": None, "spectrum": [], "signal_quality": "error", "error": str(exc)}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _normalize(self, mat: np.ndarray) -> np.ndarray:
        mat = mat.astype(np.float64).copy()
        for row in mat:
            std = np.std(row)
            if std > 0:
                row[:] = (row - np.mean(row)) / std
        return mat

    def _extract(self, ica_output: np.ndarray):
        """
        Matches reference model.py parse_ICA_results exactly.
        Applies Hamming + irfft + square to each component, then selects
        the component with the highest total-power / peak-power ratio.
        """
        components = []
        for i in range(3):
            c = np.squeeze(np.asarray(ica_output[:, i]))
            c = np.hamming(len(c)) * c
            c = np.absolute(np.square(np.fft.irfft(c))).astype(float)
            components.append(c)

        ratios = [np.sum(c) / (np.amax(c) + 1e-9) for c in components]
        best = components[int(np.argmax(ratios))]

        # Find the dominant frequency in the HR range
        N = len(best)
        freqs = np.fft.rfftfreq(N, d=1.0 / self.FPS)
        fft_vals = np.abs(np.fft.rfft(best))
        valid = (freqs >= self.BPM_LOW) & (freqs <= self.BPM_HIGH)

        bpm = None
        if np.any(valid):
            peak_hz = float(freqs[valid][int(np.argmax(fft_vals[valid]))])
            bpm = round(peak_hz * 60, 1)

        return best.tolist(), bpm
