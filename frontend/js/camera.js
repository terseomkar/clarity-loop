/**
 * Clarity Loop camera module.
 *
 * Week 1 — ROI strategy: simple centre-rectangle crop (validation only).
 *   The centre 120×90 px region is used as a face-ROI proxy so the full
 *   pipeline (capture → RGB averages → WebSocket → ICA → BPM) can be
 *   validated end-to-end before Week 2 proper face tracking is added.
 *
 * Week 2 TODO:
 *   Replace the centre-crop with MediaPipe Face Mesh (JS):
 *     import { FaceMesh } from '@mediapipe/face_mesh';
 *   Use landmarks 10 (forehead), 234 & 454 (cheeks) as the ROI bounding box.
 *   This gives a much more stable signal and removes headtrackr.js dependency.
 *
 * WebSocket message sent every ~1 s:
 *   { type: 'hr_data', r: [...], g: [...], b: [...], bufferWindow: N }
 */

class ClarityCamera {
  constructor(onSignalUpdate) {
    this._onSignalUpdate = onSignalUpdate; // callback({hasSignal, faceDetected})

    this._video = null;
    this._canvas = document.createElement('canvas');
    this._ctx = this._canvas.getContext('2d');

    this.fps = 15;
    this.bufferWindow = 128; // frames to accumulate before sending
    this.sendIntervalMs = 1000;

    this._r = [];
    this._g = [];
    this._b = [];
    this._sendingData = false;

    this._captureTimer = null;
    this._sendTimer = null;

    // ROI for Week 1 (centre crop — replace with face mesh in Week 2)
    this._roi = null; // set after video dimensions known

    // Will be injected by app.js
    this.socket = null;
  }

  async start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      this._video = document.getElementById('camera-feed');
      if (!this._video) {
        this._video = document.createElement('video');
      }
      this._video.srcObject = stream;
      this._video.autoplay = true;
      this._video.playsInline = true;
      this._video.muted = true;
      await this._video.play();

      // Set canvas dimensions to match video
      this._canvas.width = this._video.videoWidth || 640;
      this._canvas.height = this._video.videoHeight || 480;

      // Week 1 ROI: centre third of the frame
      const w = this._canvas.width;
      const h = this._canvas.height;
      this._roi = {
        x: Math.floor(w * 0.35),
        y: Math.floor(h * 0.15),
        w: Math.floor(w * 0.30),
        h: Math.floor(h * 0.35),
      };

      this._startCapture();
      console.log('[camera] started — ROI:', this._roi);
      return true;
    } catch (err) {
      console.error('[camera] getUserMedia failed:', err);
      this._onSignalUpdate({ hasSignal: false, faceDetected: false, error: err.message });
      return false;
    }
  }

  stop() {
    if (this._captureTimer) clearInterval(this._captureTimer);
    if (this._sendTimer) clearInterval(this._sendTimer);
    if (this._video && this._video.srcObject) {
      this._video.srcObject.getTracks().forEach(t => t.stop());
    }
  }

  // ----------------------------------------------------------------
  // Private
  // ----------------------------------------------------------------

  _startCapture() {
    // Draw video → canvas and extract RGB at FPS
    this._captureTimer = setInterval(() => this._captureFrame(), 1000 / this.fps);

    // Send buffer to backend every second
    this._sendTimer = setInterval(() => this._sendBuffer(), this.sendIntervalMs);
  }

  _captureFrame() {
    if (!this._video || this._video.readyState < 2) return;

    this._ctx.drawImage(this._video, 0, 0, this._canvas.width, this._canvas.height);

    const { x, y, w, h } = this._roi;
    const imageData = this._ctx.getImageData(x, y, w, h);
    const pixels = imageData.data; // [R, G, B, A, R, G, B, A, ...]

    let rSum = 0, gSum = 0, bSum = 0;
    const pixelCount = pixels.length / 4;
    for (let i = 0; i < pixels.length; i += 4) {
      rSum += pixels[i];
      gSum += pixels[i + 1];
      bSum += pixels[i + 2];
    }

    const rAvg = rSum / pixelCount;
    const gAvg = gSum / pixelCount;
    const bAvg = bSum / pixelCount;

    // Maintain a rolling buffer of bufferWindow samples
    if (this._g.length < this.bufferWindow) {
      this._r.push(rAvg);
      this._g.push(gAvg);
      this._b.push(bAvg);
      if (this._g.length > this.bufferWindow / 8) {
        this._sendingData = true;
      }
    } else {
      this._r.push(rAvg); this._r.shift();
      this._g.push(gAvg); this._g.shift();
      this._b.push(bAvg); this._b.shift();
    }

    this._onSignalUpdate({ hasSignal: this._sendingData, faceDetected: false /* Week 2 */ });
  }

  _sendBuffer() {
    if (!this._sendingData || !this.socket || !this.socket.connected) return;
    this.socket.send({
      type: 'hr_data',
      r: [...this._r],
      g: [...this._g],
      b: [...this._b],
      bufferWindow: this._g.length,
    });
  }
}
