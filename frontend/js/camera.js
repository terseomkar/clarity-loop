/**
 * Clarity Loop camera module — Week 2.
 *
 * Two ROIs are extracted every frame:
 *
 *   Face ROI  — forehead + cheeks (upper 55% of face bounding box)
 *               → RGB channel averages → heart rate pipeline (rPPG)
 *
 *   Chest ROI — shoulders / upper torso (below face, or lower half of frame)
 *               → luminance averages → respiration pipeline
 *               Same technique as the Respiration-Rate-Detection reference:
 *               mean pixel intensity oscillates as the chest rises and falls.
 *
 * MediaPipe Face Mesh drives both ROIs.  Falls back to static crops when no
 * face is detected.
 *
 * MediaPipe Pose runs in parallel (Week 3) at ~5 fps.  We forward only the
 * seven front-view landmarks used by the posture pipeline (0, 7, 8, 11, 12,
 * 23, 24) — the backend computes posture metrics + restlessness variance.
 *
 * WebSocket messages:
 *   ~1/s : { type:'hr_data',   r:[…], g:[…], b:[…], chest:[…], bufferWindow, fps }
 *   ~5/s : { type:'pose_data', landmarks: { "0":{x,y,visibility}, ... } }
 */

class ClarityCamera {
  /**
   * @param {function} onSignalUpdate  Called per capture frame with status flags.
   * @param {object}   [opts]
   * @param {boolean}  [opts.drawLandmarks=false]  Overlay pose landmarks instead of ROI boxes.
   * @param {function} [opts.onChestSample]        Called per capture frame with raw chest luminance.
   * @param {function} [opts.onPoseSample]         Called per pose update with (landmarksObj, motionMagnitude).
   */
  constructor(onSignalUpdate, opts = {}) {
    this._onSignalUpdate = onSignalUpdate;
    this._drawLandmarks  = !!opts.drawLandmarks;
    this._onChestSample  = opts.onChestSample || null;
    this._onPoseSample   = opts.onPoseSample  || null;

    this._video  = null;
    this._canvas = document.createElement('canvas');
    this._ctx    = this._canvas.getContext('2d');

    this.fps           = 15;
    this.bufferWindow  = 128;
    this.sendIntervalMs = 1000;

    // Heart-rate buffers (face ROI RGB averages)
    this._r = []; this._g = []; this._b = [];
    // Respiration buffer (chest ROI luminance averages)
    this._chest = [];

    this._sendingData    = false;
    this._captureTimer   = null;
    this._sendTimer      = null;
    this._frameTimes     = [];
    this._faceFrameCount = 0;
    this._poseFrameCount = 0;

    // ROI state
    this._centerCropRoi = null;
    this._roi           = null;   // active face ROI
    this._chestRoi      = null;   // active chest ROI
    this._faceDetected  = false;

    // MediaPipe models
    this._faceMesh      = null;
    this._pose          = null;
    this._poseDetected  = false;
    this._latestPose    = null;  // last 7 landmarks {idx: {x, y, visibility}}
    this._prevPoseForMotion = null;  // previous landmarks, for frame-to-frame motion

    this.socket = null;   // injected by app.js
  }

  // ----------------------------------------------------------------
  // Public
  // ----------------------------------------------------------------

  async start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      this._video = document.getElementById('camera-feed') || document.createElement('video');
      this._video.srcObject  = stream;
      this._video.autoplay   = true;
      this._video.playsInline = true;
      this._video.muted      = true;
      await this._video.play();

      this._canvas.width  = this._video.videoWidth  || 640;
      this._canvas.height = this._video.videoHeight || 480;

      const W = this._canvas.width;
      const H = this._canvas.height;

      // Default face ROI: centre-crop (Week 1 fallback)
      this._centerCropRoi = {
        x: Math.floor(W * 0.35),
        y: Math.floor(H * 0.15),
        w: Math.floor(W * 0.30),
        h: Math.floor(H * 0.35),
      };
      this._roi = { ...this._centerCropRoi };

      // Default chest ROI: lower half of frame, full width (shoulders / upper torso)
      this._chestRoi = {
        x: Math.floor(W * 0.05),
        y: Math.floor(H * 0.55),
        w: Math.floor(W * 0.90),
        h: Math.floor(H * 0.35),
      };

      this._initFaceMesh();
      this._initPose();
      this._startCapture();
      console.log('[camera] started — face ROI:', this._roi, ' chest ROI:', this._chestRoi);
      return true;
    } catch (err) {
      console.error('[camera] getUserMedia failed:', err);
      this._onSignalUpdate({ hasSignal: false, faceDetected: false, error: err.message });
      return false;
    }
  }

  stop() {
    if (this._captureTimer) clearInterval(this._captureTimer);
    if (this._sendTimer)    clearInterval(this._sendTimer);
    if (this._video && this._video.srcObject) {
      this._video.srcObject.getTracks().forEach(t => t.stop());
    }
  }

  // ----------------------------------------------------------------
  // MediaPipe Face Mesh
  // ----------------------------------------------------------------

  _initFaceMesh() {
    if (typeof FaceMesh === 'undefined') {
      console.warn('[camera] FaceMesh not loaded — using static-crop fallback');
      return;
    }
    this._faceMesh = new FaceMesh({
      locateFile: file =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`,
    });
    this._faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    this._faceMesh.onResults(results => {
      const lms = results.multiFaceLandmarks && results.multiFaceLandmarks[0];
      if (lms) {
        this._faceDetected = true;
        this._updateRoisFromLandmarks(lms);
      } else {
        this._faceDetected = false;
        this._roi      = { ...this._centerCropRoi };
        this._chestRoi = this._defaultChestRoi();
      }
    });
    console.log('[camera] MediaPipe Face Mesh initialised');
  }

  // ----------------------------------------------------------------
  // MediaPipe Pose (Week 3 — posture + restlessness)
  // ----------------------------------------------------------------

  _initPose() {
    if (typeof Pose === 'undefined') {
      console.warn('[camera] Pose not loaded — posture pipeline disabled');
      return;
    }
    this._pose = new Pose({
      locateFile: file =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`,
    });
    this._pose.setOptions({
      modelComplexity: 0,         // "lite" — fast enough alongside Face Mesh
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    const WANTED = [0, 7, 8, 11, 12, 23, 24]; // see posture.py for what each is

    this._pose.onResults(results => {
      const lms = results.poseLandmarks;
      if (!lms) {
        this._poseDetected = false;
        return;
      }
      this._poseDetected = true;

      const out = {};
      for (const idx of WANTED) {
        const lm = lms[idx];
        if (!lm) continue;
        out[idx] = {
          x: lm.x,
          y: lm.y,
          visibility: lm.visibility ?? 1.0,
        };
      }
      this._latestPose = out;

      // Frame-to-frame landmark motion magnitude — sum of |Δposition| across
      // visible landmarks.  This is the raw signal the backend's restlessness
      // variance is derived from.
      let motion = 0;
      if (this._prevPoseForMotion) {
        for (const idx of WANTED) {
          const cur = out[idx];
          const prv = this._prevPoseForMotion[idx];
          if (!cur || !prv) continue;
          if ((cur.visibility ?? 1) < 0.5) continue;
          motion += Math.abs(cur.x - prv.x) + Math.abs(cur.y - prv.y);
        }
      }
      this._prevPoseForMotion = out;

      if (this._onPoseSample) this._onPoseSample(out, motion);

      if (this.socket && this.socket.connected) {
        this.socket.send({ type: 'pose_data', landmarks: out });
      }
    });
    console.log('[camera] MediaPipe Pose initialised');
  }

  _defaultChestRoi() {
    const W = this._canvas.width;
    const H = this._canvas.height;
    return {
      x: Math.floor(W * 0.05),
      y: Math.floor(H * 0.55),
      w: Math.floor(W * 0.90),
      h: Math.floor(H * 0.35),
    };
  }

  _updateRoisFromLandmarks(landmarks) {
    const vw = this._canvas.width;
    const vh = this._canvas.height;

    // Full face bounding box
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const lm of landmarks) {
      if (lm.x < minX) minX = lm.x;
      if (lm.x > maxX) maxX = lm.x;
      if (lm.y < minY) minY = lm.y;
      if (lm.y > maxY) maxY = lm.y;
    }

    const faceH = maxY - minY;

    // Face ROI: upper 55% of face bounding box (forehead + cheeks)
    this._roi = {
      x: Math.max(0, Math.floor(minX * vw)),
      y: Math.max(0, Math.floor(minY * vh)),
      w: Math.min(vw, Math.ceil((maxX - minX) * vw)),
      h: Math.min(vh, Math.ceil(faceH * 0.55 * vh)),
    };

    // Chest ROI: just below the chin, wider than the face for shoulders
    const chinY   = Math.floor(maxY * vh);
    const margin  = 8;
    const chestTop = Math.min(chinY + margin, vh - 30);
    const chestH   = Math.min(vh - chestTop - 5, 130);
    const extra    = Math.floor((maxX - minX) * vw * 0.25); // 25% wider each side
    this._chestRoi = {
      x: Math.max(0, Math.floor(minX * vw) - extra),
      y: chestTop,
      w: Math.min(vw, Math.ceil((maxX - minX) * vw) + extra * 2),
      h: Math.max(0, chestH),
    };
  }

  // ----------------------------------------------------------------
  // Capture loop
  // ----------------------------------------------------------------

  _startCapture() {
    this._captureTimer = setInterval(() => this._captureFrame(), 1000 / this.fps);
    this._sendTimer    = setInterval(() => this._sendBuffer(),  this.sendIntervalMs);
  }

  _actualFps() {
    if (this._frameTimes.length < 2) return this.fps;
    const dt = (this._frameTimes[this._frameTimes.length - 1] - this._frameTimes[0]) / 1000;
    return (this._frameTimes.length - 1) / dt;
  }

  _captureFrame() {
    if (!this._video || this._video.readyState < 2) return;

    const now = performance.now();
    this._frameTimes.push(now);
    if (this._frameTimes.length > 30) this._frameTimes.shift();

    this._ctx.drawImage(this._video, 0, 0, this._canvas.width, this._canvas.height);

    // Send every 5th frame to face mesh for async ROI update (~3 fps)
    this._faceFrameCount++;
    if (this._faceMesh && this._faceFrameCount % 5 === 0) {
      this._faceMesh.send({ image: this._video }).catch(() => {});
    }

    // Send every 3rd frame to pose (~5 fps) — gives ~30 samples over
    // the backend's 6 s restlessness window.  Offset by 1 so face mesh
    // and pose rarely fire on the same capture tick.
    this._poseFrameCount++;
    if (this._pose && (this._poseFrameCount + 1) % 3 === 0) {
      this._pose.send({ image: this._video }).catch(() => {});
    }

    // ── Face ROI → RGB averages (heart rate) ──────────────────────
    const { x, y, w, h } = this._roi;
    const facePixels = this._ctx.getImageData(x, y, w, h).data;
    let rSum = 0, gSum = 0, bSum = 0;
    const faceCount = facePixels.length / 4;
    for (let i = 0; i < facePixels.length; i += 4) {
      rSum += facePixels[i];
      gSum += facePixels[i + 1];
      bSum += facePixels[i + 2];
    }
    this._pushRolling(this._r, rSum / faceCount);
    this._pushRolling(this._g, gSum / faceCount);
    this._pushRolling(this._b, bSum / faceCount);

    if (this._g.length > this.bufferWindow / 8) this._sendingData = true;

    // ── Chest ROI → luminance averages (respiration) ───────────────
    if (this._chestRoi && this._chestRoi.h > 20 && this._chestRoi.w > 20) {
      const { x: cx, y: cy, w: cw, h: ch } = this._chestRoi;
      const chestPixels = this._ctx.getImageData(cx, cy, cw, ch).data;
      let lumSum = 0;
      const chestCount = chestPixels.length / 4;
      for (let i = 0; i < chestPixels.length; i += 4) {
        // Rec. 601 luminance weights
        lumSum += 0.299 * chestPixels[i] + 0.587 * chestPixels[i + 1] + 0.114 * chestPixels[i + 2];
      }
      const chestLum = lumSum / chestCount;
      this._pushRolling(this._chest, chestLum);
      if (this._onChestSample) this._onChestSample(chestLum);
    }

    if (this._drawLandmarks) {
      this._drawLandmarkOverlay();
    } else {
      this._drawRoiOverlay();
    }
    this._onSignalUpdate({
      hasSignal:     this._sendingData,
      faceDetected:  this._faceDetected,
      poseDetected:  this._poseDetected,
    });
  }

  _pushRolling(buf, value) {
    if (buf.length < this.bufferWindow) {
      buf.push(value);
    } else {
      buf.push(value);
      buf.shift();
    }
  }

  // ----------------------------------------------------------------
  // ROI debug overlay
  // ----------------------------------------------------------------

  _drawRoiOverlay() {
    const canvas = document.getElementById('roi-canvas');
    if (!canvas) return;

    if (canvas.width !== this._canvas.width) {
      canvas.width  = this._canvas.width;
      canvas.height = this._canvas.height;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Face ROI (green solid = face tracked, purple dashed = fallback)
    const { x, y, w, h } = this._roi;
    if (this._faceDetected) {
      ctx.strokeStyle = 'rgba(100,220,140,0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(x, y, w, h);
      ctx.font = '10px monospace';
      ctx.fillStyle = 'rgba(100,220,140,0.75)';
      ctx.fillText('face mesh', x + 4, y - 4);
    } else {
      ctx.strokeStyle = 'rgba(152,120,232,0.55)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.font = '10px monospace';
      ctx.fillStyle = 'rgba(152,120,232,0.55)';
      ctx.fillText('centre crop', x + 4, y - 4);
    }

    // Chest ROI (cyan dashed)
    if (this._chestRoi && this._chestRoi.h > 20) {
      const { x: cx, y: cy, w: cw, h: ch } = this._chestRoi;
      ctx.strokeStyle = 'rgba(80,200,230,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 6]);
      ctx.strokeRect(cx, cy, cw, ch);
      ctx.font = '10px monospace';
      ctx.fillStyle = 'rgba(80,200,230,0.5)';
      ctx.fillText('chest motion', cx + 4, cy + 13);
    }

    ctx.setLineDash([]); // reset
  }

  // ----------------------------------------------------------------
  // Landmark overlay (Observational Mode)
  // ----------------------------------------------------------------

  _drawLandmarkOverlay() {
    const canvas = document.getElementById('roi-canvas');
    if (!canvas) return;
    if (canvas.width !== this._canvas.width) {
      canvas.width  = this._canvas.width;
      canvas.height = this._canvas.height;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const lms = this._latestPose;
    if (!lms) return;

    const W = canvas.width, H = canvas.height;
    const px = lm => [lm.x * W, lm.y * H];

    // Skeleton edges (pairs of landmark indices)
    const EDGES = [
      [7, 8],    // ear to ear
      [11, 12],  // shoulder line
      [23, 24],  // hip line
      [11, 23],  // left torso edge
      [12, 24],  // right torso edge
      [0, 11],   // nose to left shoulder
      [0, 12],   // nose to right shoulder
    ];

    // Edges first (so dots draw on top)
    ctx.strokeStyle = 'rgba(152,120,232,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [a, b] of EDGES) {
      const la = lms[a], lb = lms[b];
      if (!la || !lb) continue;
      if ((la.visibility ?? 1) < 0.5 || (lb.visibility ?? 1) < 0.5) continue;
      const [ax, ay] = px(la), [bx, by] = px(lb);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();

    // Landmark dots
    for (const idx of Object.keys(lms)) {
      const lm = lms[idx];
      if ((lm.visibility ?? 1) < 0.5) continue;
      const [x, y] = px(lm);
      // outer glow
      ctx.fillStyle = 'rgba(152,120,232,0.25)';
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
      // core dot
      ctx.fillStyle = 'rgba(216,208,232,0.95)';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ----------------------------------------------------------------
  // WebSocket send
  // ----------------------------------------------------------------

  _sendBuffer() {
    if (!this._sendingData || !this.socket || !this.socket.connected) return;
    this.socket.send({
      type:         'hr_data',
      r:            [...this._r],
      g:            [...this._g],
      b:            [...this._b],
      chest:        [...this._chest],
      bufferWindow: this._g.length,
      fps:          this._actualFps(),
    });
  }
}
