// Работа с сервером: REST-запросы и WebSocket для событий в реальном времени

const Api = {
  base: '',
  token: '',

  async request(method, path, body) {
    let res;
    try {
      res = await fetch(`${this.base}/api${path}`, {
        method,
        headers: {
          ...(body && { 'Content-Type': 'application/json' }),
          ...(this.token && { Authorization: `Bearer ${this.token}` }),
        },
        body: body && JSON.stringify(body),
      });
    } catch {
      throw new Error('Сервер недоступен. Проверьте адрес и интернет.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Ошибка сервера (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },

  // Отправка файла как есть (например, картинки аватарки)
  async upload(method, path, blob) {
    let res;
    try {
      res = await fetch(`${this.base}/api${path}`, {
        method,
        headers: { 'Content-Type': blob.type, Authorization: `Bearer ${this.token}` },
        body: blob,
      });
    } catch {
      throw new Error('Сервер недоступен. Проверьте интернет.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Ошибка сервера (${res.status})`);
    return data;
  },

  get: (path) => Api.request('GET', path),
  post: (path, body = {}) => Api.request('POST', path, body),
  patch: (path, body = {}) => Api.request('PATCH', path, body),
  put: (path, body = {}) => Api.request('PUT', path, body),
  del: (path) => Api.request('DELETE', path),
};

// Постоянное соединение с сервером; при обрыве переподключается само
class ServerSocket {
  constructor({ onMessage, onStatus, onUnauthorized }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.onUnauthorized = onUnauthorized;
    this.ws = null;
    this.retry = 0;
    this.closed = false;
  }

  connect() {
    this.closed = false;
    const url = `${Api.base.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(Api.token)}`;
    const ws = (this.ws = new WebSocket(url));

    ws.onopen = () => {
      this.retry = 0;
      this.onStatus(true);
    };
    ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(e.data));
      } catch (err) {
        console.error(err);
      }
    };
    ws.onclose = async () => {
      if (this.ws !== ws) return;
      this.onStatus(false);
      if (this.closed) return;
      // Проверяем, не истёк ли токен, прежде чем переподключаться
      try {
        await Api.get('/me');
      } catch (err) {
        if (err.status === 401) return this.onUnauthorized();
      }
      const delay = Math.min(1000 * 2 ** this.retry++, 15000);
      setTimeout(() => !this.closed && this.connect(), delay);
    };
  }

  send(message) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  close() {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }
}
