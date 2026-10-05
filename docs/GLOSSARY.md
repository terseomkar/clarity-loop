# Glossary

Plain-language definitions for the terms you'll meet in this codebase.

## Sensing and signal processing

| Term | Meaning |
|---|---|
| **rPPG** (remote photoplethysmography) | Measuring pulse from video. Each heartbeat changes the skin's colour very slightly; averaged over a patch of face, a webcam can see it. See `backend/cv/heart_rate.py`. |
| **ROI** (region of interest) | A rectangle of the video frame we average over: the face ROI (forehead + cheeks) for heart rate, the chest ROI for breathing. |
| **ICA** (independent component analysis) | A technique that "un-mixes" several mixed signals into independent sources. We feed it the red/green/blue averages; one output usually carries the pulse. |
| **JADE** | The specific ICA algorithm we use (`backend/cv/jade.py`). |
| **FFT** (fast Fourier transform) | Converts a signal over time into its frequencies. The strongest frequency in the right band gives beats or breaths per minute. |
| **SNR** (signal-to-noise ratio) | Here: the strongest frequency's power divided by the average power in the band. Higher means a cleaner reading. Drives `signal_quality`. |
| **Band-pass filter** | Keeps only frequencies in a range (e.g. 9–30 breaths/min) and removes the rest. |
| **Butterworth / SOS** | A standard smooth filter design; "SOS" (second-order sections) is a numerically stable way to apply it. |
| **Detrend** | Removing slow drift (lighting changes, shifting in a chair) from a signal before analysing it. |
| **EMA** (exponential moving average) | A cheap running smoother: `new = α·latest + (1−α)·previous`. |
| **Rolling median** | The median of the last N readings; used to drop one-off glitches in BPM. |
| **Baseline** | The person's own "resting" averages, captured after ~30 s. States are judged relative to it, not against fixed numbers. |
| **BPM / RR** | Beats per minute (heart rate) / respiration rate (breaths per minute). |
| **Tidal volume** | The size of a normal resting breath. The browser code estimates it as the average peak-to-trough swing of the chest signal. |
| **depthRatio** | Current breath size ÷ baseline (tidal) breath size. 1.0 = a normal breath. |
| **I:E / E:I ratio** | Inhale-to-exhale (or exhale-to-inhale) duration ratio. A long, slow exhale is calming. |
| **Restlessness** | 0–1 score of how much the body is moving, from the spread of landmark positions over ~6 s (`backend/cv/posture.py`). |
| **Slump score** | Vertical distance from shoulders to hips in the image; smaller = more slouched. |
| **MediaPipe** | Google's in-browser models for face landmarks (Face Mesh) and body landmarks (Pose). They run in the browser, so no video is uploaded. |
| **Landmark** | A tracked point on the face or body (e.g. nose, left shoulder) with x/y image coordinates and a visibility score. |
| **EVM** (Eulerian video magnification) | A technique that amplifies tiny motions in video. The respiration reference project used it; Clarity Loop does not. |
| **EEG / BCI** | Electroencephalography (brain electrical activity measured at the scalp) / brain-computer interface. The planned student extension. See [EXTENDING.md](EXTENDING.md). |

## The app and its experience

| Term | Meaning |
|---|---|
| **Grandmaster Oshi** | The in-app guide: an ancient sloth sage who speaks one short line per survey screen and a reflection after a game. |
| **Survey / retrospective** | The landing page (`/`). Before a game: what you feel and where. After: how it shifted, plus Oshi's reflection. |
| **Scripted vs live line** | Every Oshi line has a pre-written (scripted) version that always works, upgraded to a live Claude Haiku line when an API key is set and the reply passes the guardrails. |
| **Guardrails** | `backend/orchestrator/oshi/guardrails.py`. They cap Oshi's lines at two sentences and reject banned words (clinical, numeric or "fix-it" language). |
| **State label** | The single word `PhysiologicalStateModel` derives: `elevated`, `settling`, `settled`, `dissociated` or `unknown`. |
| **Intervention** | A short regulating exercise (e.g. extended exhale). See [micro-interventions.md](micro-interventions.md). The picker exists but is not wired to the UI. |
| **Claude Haiku** | Anthropic's small, fast language model, used for Oshi's live lines and the intervention picker (`claude-haiku-4-5-20251001`). |
| **IFS "part"** | From Internal Family Systems therapy: a feeling is treated as one *part* of a person to notice and welcome, not the whole person. Oshi says "this part", not "your anxiety". |
| **EFT** (Emotional Freedom Techniques) | Tapping a sequence of points on the face and upper body while naming a feeling. Game 4. |
| **Box breathing** | Inhale 4 s, hold 4 s, exhale 4 s, hold 4 s. Game 3. |
| **Adherence** | Game 3: how closely the player's breathing follows the box pace (0–1). |

## Design vocabulary

| Term | Meaning |
|---|---|
| **Calm Technology** | Technology that informs without demanding attention, staying at the edge of awareness. |
| **Ambiguity as Design** | Deliberately showing trends and impressions instead of precise numbers, which invites reflection over judgement. |
| **Somaesthetic** | Design centred on bodily experience and felt sensation. |
| **Phenomenological language** | Describing what something *feels like* ("a tight bark", "a cold fog") rather than measuring or diagnosing it. |

The full design background is in [design-principles.md](design-principles.md); the binding rules are in [CLAUDE.md](../CLAUDE.md#design-rules-binding).
