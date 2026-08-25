export interface SessionStore {
  set(key: string, value: string, _mode: 'EX', ttlSeconds: number): Promise<'OK'>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  duplicate(): SessionStore;
  disconnect(): void;
}

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

export class MemorySessionStore implements SessionStore {
  private readonly data = new Map<string, MemoryEntry>();

  async set(key: string, value: string, _mode: 'EX', ttlSeconds: number): Promise<'OK'> {
    this.data.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const entry = this.data.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }

  async del(key: string): Promise<number> {
    return this.data.delete(key) ? 1 : 0;
  }

  duplicate(): SessionStore {
    return this;
  }

  disconnect(): void {
    this.data.clear();
  }
}

export interface QueueJob {
  id?: string;
  remove(): Promise<void>;
}

export interface RunQueuePort {
  add(
    name: string,
    data: unknown,
    opts?: { jobId?: string; removeOnComplete?: number; removeOnFail?: number },
  ): Promise<QueueJob>;
  getJob(id: string): Promise<QueueJob | undefined>;
  close(): Promise<void>;
}

export class MemoryRunQueue implements RunQueuePort {
  readonly added: Array<{ name: string; data: unknown }> = [];
  private readonly jobs = new Map<string, QueueJob>();

  async add(
    name: string,
    data: unknown,
    opts?: { jobId?: string },
  ): Promise<QueueJob> {
    const id = opts?.jobId ?? crypto.randomUUID();
    const job: QueueJob = {
      id,
      remove: async () => {
        this.jobs.delete(id);
      },
    };
    this.jobs.set(id, job);
    this.added.push({ name, data });
    return job;
  }

  async getJob(id: string): Promise<QueueJob | undefined> {
    return this.jobs.get(id);
  }

  async close(): Promise<void> {
    this.jobs.clear();
  }
}
