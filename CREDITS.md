# Credits and third-party material

Clarity Loop builds on other people's code, research and media. This file
lists what we know about each item. Entries marked **TODO** still need their
source or license confirmed before any public release.

> **Project license:** not decided yet. Read the `jade.py` entry below before
> choosing one: that file is GPL-v3. Internal coursework and university demos
> are fine under the current setup; the license question matters once the
> code is distributed publicly.

## Code and algorithms

| Item | Used in | Source | License |
|---|---|---|---|
| JADE ICA (`jadeR.py`), by Jean-François Cardoso (MATLAB original) and Gabriel J. L. Beckers (NumPy port) | `backend/cv/jade.py` (copied, ported to Python 3) | via the Heart-Rate-Detection project below | **GPL-v3** (stated in the file header) |
| "Pulse" webcam heart-rate project by Camille Teicheira: the ICA + FFT pipeline and component-selection rule | `backend/cv/heart_rate.py` (logic adapted) | https://github.com/avinashhsinghh/Heart-Rate-Detection (fork of camilleanne/biofeedback) | BSD-style, "Copyright (c) 2013 Camille Teicheira". **TODO:** keep the copyright notice if we redistribute. |
| Underlying rPPG research | heart-rate approach | Poh, McDuff & Picard (2010), *Non-contact, automated cardiac pulse measurements using video imaging and blind source separation* | research paper (cited, not copied) |
| "respmon" webcam respiration monitor by GitHub user kevroy314 | the chest-region breathing idea in `backend/cv/respiration.py` and `frontend/js/camera.js` | https://github.com/kevroy314/respmon | **GPL-v3**. **TODO:** confirm no code was copied; our implementation looks independent (it uses brightness averages, not the original's motion magnification). |
| MediaPipe Face Mesh + Pose (Google) | loaded from the jsDelivr CDN in the HTML pages | https://github.com/google-ai-edge/mediapipe | Apache-2.0 |
| Geoffrey Roberts' feeling wheel (the emotion categories) | `frontend/js/oshi_flow.js` (`FWHEEL`) | Geoffrey Roberts, "The Feeling Wheel" | **TODO:** confirm usage terms for the word list |

## Audio (`audio/`)

| File | Source | License |
|---|---|---|
| `20221__ls__bird-call.wav` | Freesound sound #20221 by user "ls" | **TODO:** check on freesound.org (CC0 / CC-BY / CC-BY-NC). CC-BY requires attribution, and CC-BY-NC forbids commercial use. |
| `805152__mrspivey__bird-call-01.wav` | Freesound sound #805152 by user "mrspivey" | **TODO:** check on freesound.org |
| `800738__whisperingearth__small-waterfall-in-a-park.mp3` | Freesound sound #800738 by user "whisperingearth" | **TODO:** check on freesound.org |
| `soundreality-fluorescent-forest-ambient-536763.mp3` | Pixabay, track #536763 by "SoundReality" (from the filename) | Pixabay Content License (**TODO:** confirm) |
| `5 Minute Native American Flute Meditation Music.mp3` | **TODO:** source unknown | **TODO:** unknown. Replace this file or find its source before any public release. |

## Images and video (`frontend/img/`, `frontend/video/`)

| File | Source |
|---|---|
| `oshi.png`, `oshi-*.png` (Grandmaster Oshi portraits) | AI-generated for this project. **TODO:** record which tool made them and check its terms. |
| `oshi.mp4` (3-second Oshi clip on Game 2) | AI-generated for this project. **TODO:** as above. |
| `rune_circle.png` | AI-generated for this project. **TODO:** as above. |

## Fonts and libraries

No other third-party JavaScript libraries are used. The frontend is plain
HTML/CSS/JS. Python dependencies are listed in `backend/requirements.txt` and
use their own (permissive) licenses.
