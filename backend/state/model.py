"""
Physiological state model — turns raw readings into one state label.

Combines heart rate (HR), restlessness and posture slump into a single label
that the rest of the app can reason about (the dev Signals page shows it,
and the intervention picker in orchestrator/ receives it). Breathing rate (RR) is
stored in the snapshot but NOT used by classify() yet — single RR readings
are too noisy to tell "settling" from "settled".

This is the natural place for a new signal (e.g. an EEG-derived calm/focus
score) to join the state picture — see docs/EXTENDING.md.

State labels
------------
    elevated     HR clearly above the person's baseline AND body moving
                 → activated / keyed up
    settling     HR at or below baseline, body not actively moving
                 → coming down toward calm
    settled      very still + HR near baseline + upright posture
                 → at ease, present
    dissociated  very still + slumped + HR not elevated
                 → withdrawn / collapsed (deliberately kept separate from
                   "settled": stillness is not always ease)
    unknown      not enough data, or the pattern matches none of the above

Baseline
--------
Every comparison is relative to the person's own baseline, because rPPG
heart rate drifts in absolute terms but its *changes* are reliable. The
baseline auto-locks once AUTO_BASELINE_SAMPLES heart-rate readings have
arrived (~30 s at one reading per second). Before that, only "settled" or
"unknown" can be returned.

Thresholds were hand-tuned on live webcam sessions:
    - resting HR read ~70-95 BPM (rPPG drifts upward, so we compare deltas)
    - a breath-hold pushed HR from a 70 baseline to 113 (~60% above)
    - restlessness: ≤0.10 settled, ≥0.30 noticeable movement, ≥0.50 fidgeting
    - slump_score: 0.25-0.35 upright, <0.20 slouched
"""

from dataclasses import dataclass
from collections import deque
from typing import Literal

StateLabel = Literal["unknown", "elevated", "settling", "settled", "dissociated"]


@dataclass
class PhysioSnapshot:
    """Averaged readings at one moment, plus the derived state label.
    Also used to store the locked baseline."""
    hr_bpm: float | None = None
    rr_bpm: float | None = None
    restlessness: float | None = None
    posture_slump: float | None = None
    state: StateLabel = "unknown"


class PhysiologicalStateModel:
    """Rolling buffers of recent readings for ONE user (main.py creates one
    per WebSocket connection). Feed it with push(); read it with
    current_snapshot() or classify()."""

    WINDOW = 30          # rolling buffer for baseline accumulation (~30 s)
    LIVE_WINDOW = 5      # samples used by classify() for *live* state (~5 s)
                         # — using the full WINDOW lags transitions badly, since
                         # a brief HR spike gets washed out by the prior 25 s of
                         # settled data.  Baseline still uses the full WINDOW.

    # Auto-baseline: lock after this many HR samples accumulated (~30 s at
    # 1 push/s from the WS handler).
    AUTO_BASELINE_SAMPLES = 30

    # Classification thresholds — hand-tuned on live webcam sessions.
    # All HR comparisons use fractional delta from baseline (rPPG absolute
    # value drifts but the relative shift is reliable).
    HR_ELEVATED_FRAC = 0.08   # HR ≥ baseline × 1.08 → activation territory
    HR_SETTLED_FRAC  = 0.05   # HR within ±5% of baseline → at-rest
    REST_ACTIVE      = 0.30   # restlessness above this → body actively moving
    REST_SETTLED     = 0.15   # below this → genuinely still
    REST_DISSOC      = 0.10   # very still — required for the dissociated branch
    SLUMP_UPRIGHT    = 0.22   # slump_score above this → upright sitting
    SLUMP_DISSOC     = 0.20   # below this → chest compressed / slouched

    def __init__(self, auto_baseline: bool = True):
        self._hr: deque[float]            = deque(maxlen=self.WINDOW)
        self._rr: deque[float]            = deque(maxlen=self.WINDOW)
        self._restlessness: deque[float]  = deque(maxlen=self.WINDOW)
        self._posture_slump: deque[float] = deque(maxlen=self.WINDOW)
        self._hr_sample_count             = 0
        self._auto_baseline               = auto_baseline
        self.baseline: PhysioSnapshot | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def push(
        self,
        hr: float | None = None,
        rr: float | None = None,
        restlessness: float | None = None,
        posture_slump: float | None = None,
    ):
        """Add the latest readings (None values are skipped). Locks the
        baseline automatically once enough heart-rate samples arrive."""
        if hr is not None:
            self._hr.append(hr)
            self._hr_sample_count += 1
            # Auto-lock baseline once warmup completes (no-op once explicitly locked)
            if (self._auto_baseline
                and self.baseline is None
                and self._hr_sample_count >= self.AUTO_BASELINE_SAMPLES):
                self.lock_baseline()
        if rr is not None:
            self._rr.append(rr)
        if restlessness is not None:
            self._restlessness.append(restlessness)
        if posture_slump is not None:
            self._posture_slump.append(posture_slump)

    def lock_baseline(self) -> PhysioSnapshot:
        """Freeze the current full-window averages as this user's baseline."""
        self.baseline = PhysioSnapshot(
            hr_bpm=self._mean(self._hr),
            rr_bpm=self._mean(self._rr),
            restlessness=self._mean(self._restlessness),
            posture_slump=self._mean(self._posture_slump),
            state=self.classify(),
        )
        return self.baseline

    def current_snapshot(self) -> PhysioSnapshot:
        """Full-window averages right now, plus the live state label."""
        return PhysioSnapshot(
            hr_bpm=self._mean(self._hr),
            rr_bpm=self._mean(self._rr),
            restlessness=self._mean(self._restlessness),
            posture_slump=self._mean(self._posture_slump),
            state=self.classify(),
        )

    def classify(self) -> StateLabel:
        """Return the live state label (see module docstring for meanings).
        Rules are checked in priority order; first match wins."""
        # Live values — recent samples only.  Baseline lock still uses _mean()
        # over the full WINDOW, but live state needs to react to transitions.
        hr    = self._recent_mean(self._hr)
        rest  = self._recent_mean(self._restlessness)
        slump = self._recent_mean(self._posture_slump)

        if hr is None:
            return "unknown"

        # Pre-baseline: only "settled" can be safely claimed (no delta reference)
        if self.baseline is None or self.baseline.hr_bpm is None:
            if (rest is not None and rest < self.REST_SETTLED
                and (slump is None or slump > self.SLUMP_UPRIGHT)):
                return "settled"
            return "unknown"

        baseline_hr   = self.baseline.hr_bpm
        hr_delta_frac = (hr - baseline_hr) / baseline_hr
        rest_value    = rest if rest is not None else 0.0

        # 1. Elevated — both HR and body must signal activation.  Either signal
        # alone is too noisy (HR drifts; restlessness includes habitual fidget).
        if hr_delta_frac > self.HR_ELEVATED_FRAC and rest_value > self.REST_ACTIVE:
            return "elevated"

        # 2. Dissociated — slumped + very still + HR not elevated.  This is
        # deliberately *distinct* from settled (withdrawn ≠ at ease).
        # Requires hips visible (slump must not be None) to distinguish from
        # the upright-but-still case.
        if (slump is not None and slump < self.SLUMP_DISSOC
            and rest_value < self.REST_DISSOC
            and hr_delta_frac < self.HR_ELEVATED_FRAC):
            return "dissociated"

        # 3. Settled — still + HR at/near baseline + upright (or hips off-frame).
        # Upright is implied when slump is unknown — better to lean toward settled
        # than unknown when the user is still and HR is calm.
        if (rest_value < self.REST_SETTLED
            and hr_delta_frac < self.HR_SETTLED_FRAC
            and (slump is None or slump > self.SLUMP_UPRIGHT)):
            return "settled"

        # 4. Settling — HR at/below baseline, body not actively moving.
        # Catches the "coming down from activation" arc that's central to the
        # intervention loop (HR drops first; full stillness follows later).
        if hr_delta_frac < self.HR_SETTLED_FRAC and rest_value < self.REST_ACTIVE:
            return "settling"

        return "unknown"

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _mean(q: deque) -> float | None:
        return float(sum(q) / len(q)) if q else None

    def _recent_mean(self, q: deque) -> float | None:
        """Mean of the last LIVE_WINDOW samples only."""
        if not q:
            return None
        recent = list(q)[-self.LIVE_WINDOW:]
        return float(sum(recent) / len(recent))
