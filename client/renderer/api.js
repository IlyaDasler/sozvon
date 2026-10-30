// Работа с сервером: REST-запросы и WebSocket для событий в реальном времени

const Api = {
  base: '',
  token: '',
  online: false, // живо ли соединение с сервером (WebSocket) — его показывает точка в шапке

  async request(method, path, body, retry = method === 'GET') {
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
    } catch (err) {
      // Запрос оборвался в дороге (смена сети, VPN). Чтение безопасно повторить; запись — нет, её повторит человек
      console.warn('Запрос не дошёл до сервера:', method, path, err.message);
      if (retry) {
        await new Promise((r) => setTimeout(r, 500));
        return this.request(method, path, body, false);
      }
      throw new Error(this.netError());
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

  // Связь с сервером живая (точка зелёная) — не дошёл только этот запрос; иначе — сервер правда недоступен
  netError() {
    return this.online ? 'Запрос не дошёл до сервера — попробуйте ещё раз' : 'Сервер недоступен. Проверьте адрес и интернет.';
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
    } catch (err) {
      console.warn('Файл не дошёл до сервера:', method, path, err.message);
      throw new Error(this.netError());
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

  async connect() {
    this.closed = false;
    // Билет вместо токена: адрес соединения может осесть в журналах, а билет живёт полминуты и один раз
    let ticket;
    try {
      ({ ticket } = await Api.post('/ws-ticket'));
    } catch (err) {
      return err.status === 401 ? this.onUnauthorized() : this.retryLater();
    }
    if (this.closed) return;
    const url = `${Api.base.replace(/^http/, 'ws')}/ws?ticket=${encodeURIComponent(ticket)}`;
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
      this.retryLater();
    };
  }

  retryLater() {
    const delay = Math.min(1000 * 2 ** this.retry++, 15000);
    setTimeout(() => !this.closed && this.connect(), delay);
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
