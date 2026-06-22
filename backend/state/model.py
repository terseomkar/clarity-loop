"""
Physiological State Model — Week 3.

Combines HR, restlessness, and posture slump into a single derived state label
that the intervention orchestrator reasons against.  RR is collected into the
snapshot for downstream use (and for the Week 5 agent prompt) but not yet
factored into classify() — single RR values are too noisy to discriminate
settling vs settled.

State categories
----------------
    elevated     HR significantly above baseline AND body active (restless)
                 → sympathetic activation
    settling     HR at or below baseline + restlessness low-moderate
                 → moving toward calm
    settled      low restlessness + HR near baseline + posture upright
                 → at ease, present
    dissociated  low restlessness + slumped posture + HR not elevated
                 → withdrawn / collapsed (distinct from settled — the
                   plan calls this out explicitly)
    unknown      insufficient data, or signal pattern doesn't match above

Baseline lifecycle
------------------
Week 3 (now): auto-lock after AUTO_BASELINE_SAMPLES HR samples arrive
    (~30 s at 1 Hz).  Lets the model produce real state labels during
    standalone validation, before the subjective input flow exists.

Week 4 (planned): when "Triggered" tapped, call start_baseline_collection()
    (which disables auto-lock + resets accumulators).  When the 4-step
    subjective input completes, call lock_baseline() explicitly.

Thresholds were tuned against Week 3 live validation data:
    - resting HR ~70-95 BPM (rPPG drifts upward; we trust *deltas* per the
      project rule, not magnitudes — see auto_memory feedback note)
    - breath-hold caused HR baseline 70 → 113 (~60% above baseline)
    - restlessness: ≤0.10 settled, ≥0.30 noticeable movement, ≥0.50 fidgeting
    - slump_score: 0.25-0.35 upright, <0.20 slouched
"""

from dataclasses import dataclass
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
    WINDOW = 30          # rolling buffer for baseline accumulation (~30 s)
    LIVE_WINDOW = 5      # samples used by classify() for *live* state (~5 s)
                         # — using the full WINDOW lags transitions badly, since
                         # a brief HR spike gets washed out by the prior 25 s of
                         # settled data.  Baseline still uses the full WINDOW.

    # Auto-baseline: lock after this many HR samples accumulated (~30 s at
    # 1 push/s from the WS handler).  Week 4 will disable this in favor of
    # explicit lock at the end of the subjective input flow.
    AUTO_BASELINE_SAMPLES = 30

    # Classification thresholds — tuned against Week 3 validation data.
    # All HR comparisons use fractional delta from baseline (rPPG absolute
    # value drifts but the relative shift is reliable — per project rule).
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
        self._collecting_baseline         = False

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

    def start_baseline_collection(self):
        """
        Week 4 entry: called when the user taps 'Triggered'.  Resets accumulators
        and disables auto-lock so the subjective input flow controls timing.
        """
        self._auto_baseline       = False
        self._collecting_baseline = True
        self._hr.clear()
        self._rr.clear()
        self._restlessness.clear()
        self._posture_slump.clear()
        self._hr_sample_count     = 0
        self.baseline             = None

    def lock_baseline(self) -> PhysioSnapshot:
        self.baseline = PhysioSnapshot(
            hr_bpm=self._mean(self._hr),
            rr_bpm=self._mean(self._rr),
            restlessness=self._mean(self._restlessness),
            posture_slump=self._mean(self._posture_slump),
            state=self.classify(),
        )
        self._collecting_baseline = False
        return self.baseline

    def current_snapshot(self) -> PhysioSnapshot:
        return PhysioSnapshot(
            hr_bpm=self._mean(self._hr),
            rr_bpm=self._mean(self._rr),
            restlessness=self._mean(self._restlessness),
            posture_slump=self._mean(self._posture_slump),
            state=self.classify(),
        )

    def classify(self) -> StateLabel:
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
        # explicitly *distinct* from settled per the plan (withdrawn ≠ at ease).
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
        if not q:
            return None
        recent = list(q)[-self.LIVE_WINDOW:]
        return float(sum(recent) / len(recent))
