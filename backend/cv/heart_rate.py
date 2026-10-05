"""
Heart-rate estimation from a webcam ("rPPG").

rPPG = remote photoplethysmography: each heartbeat pushes blood into the
skin, which changes the face's colour very slightly. Averaged over a patch
of skin, that change is visible to an ordinary webcam.

Where the data comes from
    The browser (frontend/js/camera.js) finds the face with MediaPipe Face
    Mesh, averages the red/green/blue values over a forehead + cheek region
    (the "ROI", region of interest) each frame, and sends ~128 frames of those
    averages over the WebSocket about once a second ({type: "hr_data"}).

What this module does with it
    1. Stacks r/g/b into a 3×N matrix and normalises each row (zero mean,
       unit variance).
    2. Runs JADE ICA (see jade.py) to un-mix the three channels into three
       independent source signals.
    3. Windows each source (Hamming), squares its inverse FFT, and keeps the
       source with the highest total-power / peak-power ratio. This selection
       rule is copied exactly from the Heart-Rate-Detection reference project.
    4. Takes the strongest FFT frequency inside 45–200 BPM as the heart rate.
    5. Reports signal quality from the SNR (signal-to-noise ratio: peak power
       divided by mean power in that band).

Accuracy note: absolute BPM from rPPG drifts with lighting and movement.
The project deliberately treats it as a TREND (rising / falling relative to
the person's own baseline), never as a clinical number.
"""

import numpy as np

from .jade import run as jade_run


class HeartRateDetector:
    """Stateless heart-rate estimator. One instance is shared by all
    WebSocket connections (see backend/main.py)."""

    FPS: int = 15           # must match camera.js capture rate
    BPM_LOW: float = 0.75   # 45 BPM in Hz
    BPM_HIGH: float = 3.33  # 200 BPM in Hz
    MIN_BUFFER: int = 64    # samples needed before processing (~4 s at 15 fps)

    def process(self, r: list, g: list, b: list, buffer_window: int, fps: float | None = None) -> dict:
        """
        Estimate heart rate from one buffer of per-frame colour averages.

        Parameters
        ----------
        r, g, b       : per-frame channel averages (length = buffer_window)
        buffer_window : number of frames in the current buffer
        fps           : actual capture rate measured by client (falls back to self.FPS)

        Returns
        -------
        dict with keys:
            bpm           : float | None
            spectrum      : list[float]  (power spectrum for frontend display)
            signal_quality: "ok" | "poor" | "insufficient_data" | "error"
            snr           : float  (only when a BPM was computed)
        Never raises — errors come back as signal_quality "error".
        """
        if len(g) < self.MIN_BUFFER or buffer_window < self.MIN_BUFFER:
            return {"bpm": None, "spectrum": [], "signal_quality": "insufficient_data"}

        try:
            effective_fps = float(fps) if (fps and 5 <= fps <= 60) else float(self.FPS)

            # Build 3×N float64 matrix (matches reference model.py exactly)
            X = np.ndarray(shape=(3, buffer_window), buffer=np.array([r, g, b]))
            X = self._normalize(X)
            # No band-pass filter before ICA: one was tried and it biased which
            # component got selected. The 45–200 BPM band is enforced later,
            # by the valid-frequency mask in _extract().
            ica_output = jade_run(X)          # shape: (buffer_window, 3)
            spectrum, bpm, snr = self._extract(ica_output, effective_fps)

            # SNR threshold relaxed 4.0 → 3.0 to match measured signal in typical
            # indoor lighting (live testing showed SNRs of 1.7–3.8, mean ~2.7).
            # The absolute BPM still drifts — the project trusts the *change*
            # in BPM, not its exact value — but signal_quality should reflect
            # what the algorithm is actually achieving, not a textbook ideal.
            quality = "ok" if (bpm and snr > 3.0) else "poor"
            return {"bpm": bpm, "spectrum": spectrum, "signal_quality": quality, "snr": round(snr, 2)}

        except Exception as exc:
            return {"bpm": None, "spectrum": [], "signal_quality": "error", "error": str(exc)}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _normalize(self, mat: np.ndarray) -> np.ndarray:
        """Return a copy with each row rescaled to zero mean, unit variance."""
        mat = mat.astype(np.float64).copy()
        for row in mat:
            std = np.std(row)
            if std > 0:
                row[:] = (row - np.mean(row)) / std
        return mat

    def _extract(self, ica_output: np.ndarray, fps: float):
        """
        Pick the pulse-carrying ICA component and find its frequency.

        Matches parse_ICA_results() in the Heart-Rate-Detection reference
        project exactly: Hamming window + irfft(n=len) + square on each
        component, then keep the component with the highest
        total-power / peak-power ratio. n=len(c) preserves the buffer length.

        Returns (spectrum list, bpm or None, snr).
        """
        components = []
        for i in range(3):
            c = np.squeeze(np.asarray(ica_output[:, i]))
            c = np.hamming(len(c)) * c
            c = np.absolute(np.square(np.fft.irfft(c, len(c)))).astype(float)
            components.append(c)

        ratios = [np.sum(c) / (np.amax(c) + 1e-9) for c in components]
        best = components[int(np.argmax(ratios))]

        # Find the dominant frequency in the HR range
        N = len(best)
        freqs = np.fft.rfftfreq(N, d=1.0 / fps)
        fft_vals = np.abs(np.fft.rfft(best))
        valid = (freqs >= self.BPM_LOW) & (freqs <= self.BPM_HIGH)

        bpm = None
        snr = 0.0
        if np.any(valid):
            peak_hz = float(freqs[valid][int(np.argmax(fft_vals[valid]))])
            bpm = round(peak_hz * 60, 1)
            snr = float(fft_vals[valid].max()) / (float(fft_vals[valid].mean()) + 1e-9)

        return best.tolist(), bpm, snr
