"""
Respiration rate detection via chest-pixel motion tracking.

Primary pipeline (matches Respiration-Rate-Detection reference approach):
    Browser extracts per-frame mean luminance from a chest / shoulder ROI.
    As the chest rises on inhalation the average brightness of that region
    changes; this creates a periodic signal at the breathing frequency.
    Steps:
        1. Receive the 128-frame luminance buffer from the chest ROI.
        2. Remove DC (mean subtraction).
        3. Bandpass-filter to the respiratory band (0.1–0.5 Hz / 6–30 BPM)
           using a 4th-order Butterworth in SOS form (numerically stable at
           very low normalised cut frequencies).
        4. FFT peak → dominant frequency → BPM.

Fallback pipeline (green channel from face ROI):
    Used when no chest data is available (chest ROI not visible or face mesh
    not loaded).  The facial skin colour has a weak secondary respiratory
    modulation; detectable but less reactive to voluntary breathing changes.
"""

import numpy as np
from scipy.signal import butter, sosfiltfilt, detrend


class RespirationDetector:
    FPS: int       = 15
    # Floor raised from 0.1 → 0.15 Hz (6 → 9 BPM).  With N=128, fps≈15, the
    # FFT bin spacing is ~0.117 Hz — at the old 0.1 floor the second bin
    # (0.117 Hz / 7 BPM) was a noise sink that drift / lighting fluctuation
    # locked onto, masking real breathing in the 0.20–0.35 Hz range.
    RR_LOW_HZ: float  = 0.15  # 9 BPM
    RR_HIGH_HZ: float = 0.5   # 30 BPM
    MIN_BUFFER: int   = 128   # full 128-frame window (~8.5 s at 15 fps)

    def process(
        self,
        g: list,
        fps: float | None = None,
        chest: list | None = None,
    ) -> dict:
        """
        Parameters
        ----------
        g     : green channel averages from face ROI (fallback signal)
        fps   : actual capture rate from client
        chest : luminance averages from chest ROI (preferred signal)

        Returns
        -------
        dict with keys:
            rr_bpm        : float | None
            signal_quality: "ok" | "poor" | "insufficient_data" | "error"
            source        : "chest" | "green"
        """
        effective_fps = float(fps) if (fps and 5 <= fps <= 60) else float(self.FPS)

        # Prefer chest motion — direct physical signal, much stronger SNR
        if chest and len(chest) >= self.MIN_BUFFER:
            result = self._process_signal(chest, effective_fps)
            result["source"] = "chest"
            return result

        # Fallback: green channel colour modulation from face ROI
        if len(g) >= self.MIN_BUFFER:
            result = self._process_signal(g, effective_fps)
            result["source"] = "green"
            return result

        return {"rr_bpm": None, "signal_quality": "insufficient_data", "source": None}

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _process_signal(self, data: list, fps: float) -> dict:
        try:
            sig = np.array(data, dtype=np.float64)
            # Linear detrend removes slow baseline drift (lighting fluctuation,
            # posture shift) — a plain mean subtraction left a low-freq tail
            # that the FFT was locking onto at the bottom of the breathing band.
            sig = detrend(sig)

            nyq  = fps / 2.0
            low  = max(self.RR_LOW_HZ  / nyq, 0.005)
            high = min(self.RR_HIGH_HZ / nyq, 0.990)
            if high <= low:
                return {"rr_bpm": None, "signal_quality": "poor"}

            # SOS form is numerically stable at very low normalised frequencies
            sos      = butter(4, [low, high], btype="band", output="sos")
            filtered = sosfiltfilt(sos, sig)

            N        = len(filtered)
            freqs    = np.fft.rfftfreq(N, d=1.0 / fps)
            fft_vals = np.abs(np.fft.rfft(filtered))
            valid    = (freqs >= self.RR_LOW_HZ) & (freqs <= self.RR_HIGH_HZ)

            if not np.any(valid):
                return {"rr_bpm": None, "signal_quality": "poor"}

            peak_hz  = float(freqs[valid][np.argmax(fft_vals[valid])])
            rr_bpm   = round(peak_hz * 60, 1)

            peak_power = float(fft_vals[valid].max())
            mean_power = float(fft_vals[valid].mean())
            snr        = peak_power / (mean_power + 1e-9)
            # SNR threshold relaxed 2.5 → 1.8 to match real-world chest-luminance
            # signal levels (post-detrend SNRs measured at 1.3–2.2 during validation).
            quality    = "ok" if snr > 1.8 else "poor"

            return {
                "rr_bpm":         rr_bpm,
                "signal_quality": quality,
                "snr":            round(snr, 2),
                "peak_hz":        round(peak_hz, 3),
            }

        except Exception as exc:
            return {"rr_bpm": None, "signal_quality": "error", "error": str(exc)}
