"""
Physiological State Model — Week 3 implementation target.

Combines HR, respiration rate, restlessness score, and posture metrics
into a single derived state label used by the intervention orchestrator.

State categories:
    elevated     : HR > baseline + restlessness high
    settling     : HR declining + respiration rhythmic + restlessness low
    settled      : all metrics calm + posture upright
    dissociated  : HR very low + restlessness very low + posture slumped
                   (distinct from 'settled' — requires Omkar's qualitative calibration)

Baseline snapshot lifecycle:
    1. "Triggered" tapped → start accumulating rolling average.
    2. Subjective input flow completes (~30–60 s) → lock baseline snapshot.
    3. Intervention runs → live state compared against baseline.
    4. Post-intervention → post-state snapshot captured and stored in session.
"""

from dataclasses import dataclass, field
from collections import deque
from typing import Literal

StateLabel = Literal["unknown", "elevated", "settling", "settled", "dissociated"]


@dataclass
class PhysioSnapshot:
    hr_bpm: float | None = None
    rr_bpm: float | None = None
    restlessness: float | None = None
    posture_slump: float | None = None
    state: StateLabel = "unknown"


class PhysiologicalStateModel:
    """
    Maintains a rolling window of recent metrics and derives state.
    Week 3: fill in classify() with thresholds tuned from Omkar's testing.
    """

    WINDOW = 30  # last N readings (~30 s at 1 reading/s)

    def __init__(self):
        self._hr: deque[float] = deque(maxlen=self.WINDOW)
        self._rr: deque[float] = deque(maxlen=self.WINDOW)
        self._restlessness: deque[float] = deque(maxlen=self.WINDOW)
        self.baseline: PhysioSnapshot | None = None
        self._collecting_baseline = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def push(self, hr: float | None, rr: float | None, restlessness: float | None):
        if hr is not None:
            self._hr.append(hr)
        if rr is not None:
            self._rr.append(rr)
        if restlessness is not None:
            self._restlessness.append(restlessness)

    def start_baseline_collection(self):
        self._collecting_baseline = True
        self._hr.clear()
        self._rr.clear()
        self._restlessness.clear()

    def lock_baseline(self) -> PhysioSnapshot:
        """Call when subjective input flow completes."""
        self.baseline = PhysioSnapshot(
            hr_bpm=self._mean(self._hr),
            rr_bpm=self._mean(self._rr),
            restlessness=self._mean(self._restlessness),
            state=self.classify(),
        )
        self._collecting_baseline = False
        return self.baseline

    def current_snapshot(self) -> PhysioSnapshot:
        return PhysioSnapshot(
            hr_bpm=self._mean(self._hr),
            rr_bpm=self._mean(self._rr),
            restlessness=self._mean(self._restlessness),
            state=self.classify(),
        )

    def classify(self) -> StateLabel:
        """
        Derive state label from current rolling window.
        Week 3 TODO: tune thresholds with Omkar's live testing.
        Baseline comparison requires self.baseline to be set.
        """
        hr = self._mean(self._hr)
        rr = self._mean(self._rr)
        rest = self._mean(self._restlessness)

        if hr is None:
            return "unknown"

        # Simple threshold rules — replace with calibrated values in Week 3
        baseline_hr = self.baseline.hr_bpm if self.baseline else hr

        if hr > (baseline_hr * 1.1) and (rest or 0) > 0.6:
            return "elevated"
        if (rest or 1.0) < 0.2 and hr < baseline_hr:
            return "settling"
        if (rest or 1.0) < 0.15 and hr <= baseline_hr:
            return "settled"
        return "unknown"

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _mean(q: deque) -> float | None:
        return float(sum(q) / len(q)) if q else None
