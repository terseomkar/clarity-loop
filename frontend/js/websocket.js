/**
 * Clarity Loop WebSocket client.
 * Auto-reconnects on close. All outbound messages go through send().
 *
 * Usage:
 *   const ws = new ClaritySocket((msg) => app.onMessage(msg));
 *   ws.send({ type: 'hr_data', r: [...], g: [...], b: [...], bufferWindow: N });
 */
class ClaritySocket {
  constructor(onMessage) {
    this._onMessage = onMessage;
    this._socket = null;
    this._reconnectMs = 2000;
    this._connect();
  }

  _connect() {
    const url = `ws://${location.host}/ws`;
    console.log('[ws] connecting to', url);
    this._socket = new WebSocket(url);

    this._socket.onopen = () => {
      console.log('[ws] connected');
      document.dispatchEvent(new CustomEvent('ws:open'));
    };

    this._socket.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch (err) {
        console.warn('[ws] invalid json', err, e.data);
        return;
      }
      this._onMessage(msg);
    };

    this._socket.onclose = () => {
      console.log(`[ws] closed — reconnecting in ${this._reconnectMs}ms`);
      document.dispatchEvent(new CustomEvent('ws:close'));
      setTimeout(() => this._connect(), this._reconnectMs);
    };

    this._socket.onerror = (e) => {
      console.error('[ws] error', e);
    };
  }

  send(data) {
    if (this._socket && this._socket.readyState === WebSocket.OPEN) {
      this._socket.send(JSON.stringify(data));
    }
  }

  get connected() {
    return this._socket && this._socket.readyState === WebSocket.OPEN;
  }
}
