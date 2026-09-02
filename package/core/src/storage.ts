export type MaybePromise<T> = T | Promise<T>;

export interface Storage<T = any> {
  get(key: string): MaybePromise<T | undefined | null>;
  set(key: string, value: T): MaybePromise<void>;
  delete(key: string): MaybePromise<void>;
  clear?(): MaybePromise<void>;
}

export class MemoryStorage<T = any> implements Storage<T> {
  private data = new Map<string, T>();

  get(key: string): T | undefined {
    return this.data.get(key);
  }

  set(key: string, value: T): void {
    this.data.set(key, value);
  }

  delete(key: string): void {
    this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }
}

export interface SessionStorageSnapshot {
  sessionid: string;
  data: Record<string, any>;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number | null;
}

export interface SessionStorageOptions {
  keyPrefix?: string;
  ttl?: number;
}

export class SessionStorageProcessor {
  private storage: Storage<SessionStorageSnapshot>;
  private keyPrefix: string;
  private ttl?: number;

  constructor(storage: Storage<SessionStorageSnapshot> = new MemoryStorage<SessionStorageSnapshot>(), options: SessionStorageOptions = {}) {
    this.storage = storage;
    this.keyPrefix = options.keyPrefix ?? 'session:';
    this.ttl = options.ttl;
  }

  setStorage(storage: Storage<SessionStorageSnapshot>): void {
    this.storage = storage;
  }

  getStorage(): Storage<SessionStorageSnapshot> {
    return this.storage;
  }

  async load(sessionid: string): Promise<Record<string, any>> {
    const snapshot = await this.storage.get(this.getKey(sessionid));
    if (!snapshot) return {};

    if (this.isExpired(snapshot)) {
      await this.delete(sessionid);
      return {};
    }

    return { ...(snapshot.data || {}) };
  }

  async save(sessionid: string, data: Record<string, any>): Promise<void> {
    const key = this.getKey(sessionid);
    const now = Date.now();
    const current = await this.storage.get(key);
    const createdAt = current && !this.isExpired(current) ? current.createdAt : now;
    const snapshot: SessionStorageSnapshot = {
      sessionid,
      data: { ...(data || {}) },
      createdAt,
      updatedAt: now,
      expiresAt: this.ttl ? now + this.ttl : null,
    };

    await this.storage.set(key, snapshot);
  }

  async delete(sessionid: string): Promise<void> {
    await this.storage.delete(this.getKey(sessionid));
  }

  async clear(): Promise<void> {
    if (this.storage.clear) {
      await this.storage.clear();
    }
  }

  private getKey(sessionid: string): string {
    return `${this.keyPrefix}${sessionid}`;
  }

  private isExpired(snapshot: SessionStorageSnapshot): boolean {
    return typeof snapshot.expiresAt === 'number' && snapshot.expiresAt > 0 && snapshot.expiresAt <= Date.now();
  }
}
