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
}
