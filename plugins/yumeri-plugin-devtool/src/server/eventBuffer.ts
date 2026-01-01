type EventRecord = {
  type: string;
  time: number;
  payload: any;
};

export class EventBuffer {
  private buffer: EventRecord[] = [];
  private maxSize: number;

  constructor(maxSize = 200) {
    this.maxSize = maxSize;
  }

  push(type: string, payload: any) {
    this.buffer.unshift({ type, time: Date.now(), payload });
    if (this.buffer.length > this.maxSize) {
      this.buffer.length = this.maxSize;
    }
  }

  list(): EventRecord[] {
    return this.buffer.slice();
  }

  clear() {
    this.buffer = [];
  }

  /**
   * 获取指定 session 最近的路由信息（跳过 devtool 自身请求）
   */
  latestRoute(sessionId: string, ignorePrefix = '/devtool') {
    const record = this.buffer.find((item) => {
      const payload = item.payload || {};
      if (payload.sessionId !== sessionId) return false;
      if (payload.path && typeof payload.path === 'string' && payload.path.startsWith(ignorePrefix)) return false;
      return item.type === 'request:end' || item.type === 'route:end';
    });
    if (!record) return null;
    const payload = record.payload || {};
    return {
      path: payload.path,
      route: payload.route,
      plugin: payload.plugin,
      status: payload.status,
      method: payload.method,
      duration: payload.duration,
      at: record.time,
    };
  }
}
