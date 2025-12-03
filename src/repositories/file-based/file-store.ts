import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';

/**
 * Simple file-based JSON store.
 * Each collection is stored as a single JSON file.
 * Suitable for local development and restricted environments.
 */
export class FileStore<T extends { id: string }> {
  private data: Map<string, T> = new Map();
  private loaded = false;

  constructor(
    private readonly baseDir: string,
    private readonly collectionName: string
  ) {}

  private get filePath(): string {
    return join(this.baseDir, `${this.collectionName}.json`);
  }

  private async ensureDir(): Promise<void> {
    try {
      await mkdir(this.baseDir, { recursive: true });
    } catch {
      // Directory may already exist
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return;

    await this.ensureDir();

    try {
      await access(this.filePath);
      const content = await readFile(this.filePath, 'utf-8');
      const items = JSON.parse(content, reviver) as T[];
      this.data = new Map(items.map(item => [item.id, item]));
    } catch {
      // File doesn't exist yet, start with empty map
      this.data = new Map();
    }

    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.ensureDir();
    const items = Array.from(this.data.values());
    await writeFile(this.filePath, JSON.stringify(items, replacer, 2));
  }

  async get(id: string): Promise<T | null> {
    await this.load();
    return this.data.get(id) ?? null;
  }

  async getAll(): Promise<T[]> {
    await this.load();
    return Array.from(this.data.values());
  }

  async find(predicate: (item: T) => boolean): Promise<T[]> {
    await this.load();
    return Array.from(this.data.values()).filter(predicate);
  }

  async findOne(predicate: (item: T) => boolean): Promise<T | null> {
    await this.load();
    for (const item of this.data.values()) {
      if (predicate(item)) return item;
    }
    return null;
  }

  async count(predicate?: (item: T) => boolean): Promise<number> {
    await this.load();
    if (!predicate) return this.data.size;
    return Array.from(this.data.values()).filter(predicate).length;
  }

  async set(item: T): Promise<void> {
    await this.load();
    this.data.set(item.id, item);
    await this.persist();
  }

  async setMany(items: T[]): Promise<void> {
    await this.load();
    for (const item of items) {
      this.data.set(item.id, item);
    }
    await this.persist();
  }

  async delete(id: string): Promise<void> {
    await this.load();
    this.data.delete(id);
    await this.persist();
  }

  async deleteMany(predicate: (item: T) => boolean): Promise<void> {
    await this.load();
    for (const [id, item] of this.data) {
      if (predicate(item)) {
        this.data.delete(id);
      }
    }
    await this.persist();
  }

  async update(id: string, updates: Partial<T>): Promise<void> {
    await this.load();
    const item = this.data.get(id);
    if (item) {
      this.data.set(id, { ...item, ...updates });
      await this.persist();
    }
  }

  async clear(): Promise<void> {
    this.data = new Map();
    await this.persist();
  }
}

/**
 * JSON replacer to handle Date objects.
 */
function replacer(key: string, value: unknown): unknown {
  if (value instanceof Date) {
    return { __type: 'Date', value: value.toISOString() };
  }
  return value;
}

/**
 * JSON reviver to restore Date objects.
 * Handles both the wrapped format { __type: 'Date', value: '...' }
 * and plain ISO date strings for known date field names.
 */
function reviver(key: string, value: unknown): unknown {
  // Handle wrapped date format
  if (
    typeof value === 'object' &&
    value !== null &&
    '__type' in value &&
    (value as Record<string, unknown>).__type === 'Date' &&
    'value' in value
  ) {
    return new Date((value as Record<string, unknown>).value as string);
  }
  // Handle plain ISO date strings for common date field names
  if (
    typeof value === 'string' &&
    (key === 'createdAt' || key === 'updatedAt' || key === 'processedAt' || key === 'startedAt' || key === 'completedAt' || key === 'detectedAt' || key === 'addressedAt' || key === 'timestamp') &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
  ) {
    return new Date(value);
  }
  return value;
}
