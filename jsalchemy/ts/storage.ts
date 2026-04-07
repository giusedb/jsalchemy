import * as fs from 'fs';
import * as path from 'path';

// Utility to check if we're in the browser
const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

// Type for storage values
type StorageValue = Record<string, any>;

// Base Storage Interface
interface IStorage {
  get(key: string): any;
  set(key: string, value: any): void;
  del(key: string): void;
  has(key: string): boolean;
  keys(): string[];
}

// LocalStorage class (for browser)
class LocalStorage implements IStorage {
  private $storage: Record<string, string> = {};

  constructor() {
    this.$storage = {};
    if (isBrowser) {
      // In browser, use localStorage as fallback
      Object.assign(this.$storage, localStorage);
    }
  }

  get(key: string): any {
    const ret = this.$storage[key];
    if (ret !== undefined) {
      try {
        return JSON.parse(ret);
      } catch (err) {
        console.warn(`Failed to parse JSON from localStorage key: ${key}`, err);
        return undefined;
      }
    }
    return undefined;
  }

  set(key: string, value: any): void {
    this.$storage[key] = JSON.stringify(value);
    if (isBrowser) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  }

  del(key: string): void {
    delete this.$storage[key];
    if (isBrowser) {
      localStorage.removeItem(key);
    }
  }

  has(key: string): boolean {
    return key in this.$storage;
  }

  keys(): string[] {
      return Object.keys(this.$storage)
  }
}

// FileStorage class (for Node.js)
class FileStorage implements IStorage {
  private $storage: Record<string, any> = {};
  private readonly filename: string;
  private readonly filePath: string;

  constructor(filename: string) {
    this.filename = filename;
    this.filePath = path.join(path.dirname(filename), filename);

    // Ensure the file exists and load data
    this.load();
  }

  private load(): void {
    try {
      const data = fs.readFileSync(this.filePath, 'utf8');
      this.$storage = JSON.parse(data);
    } catch (err) {
      if (err instanceof Error && err.message.includes('ENOENT')) {
        // File doesn't exist — start with empty object
        this.$storage = {};
      } else {
        console.error(`Error loading file ${this.filePath}:`, err);
        this.$storage = {};
      }
    }
  }

  get(key: string): any {
    const ret = this.$storage[key];
    if (ret !== undefined) {
      try {
        return JSON.parse(ret);
      } catch (err) {
        console.warn(`Failed to parse JSON from file key: ${key}`, err);
        return undefined;
      }
    }
    return undefined;
  }

  set(key: string, value: any): void {
    this.$storage[key] = JSON.stringify(value);
    // Save to file
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.$storage, null, 2), 'utf8');
    } catch (err) {
      console.error(`Error writing to file ${this.filePath}:`, err);
    }
  }

  del(key: string): void {
    if (this.$storage[key] !== undefined) {
      delete this.$storage[key];
      try {
        fs.writeFileSync(this.filePath, JSON.stringify(this.$storage, null, 2), 'utf8');
      } catch (err) {
        console.error(`Error writing to file after deletion:`, err);
      }
    }
  }

  has(key: string): boolean {
    return key in this.$storage;
  }

  keys(): string[] {
      return Object.keys(this.$storage)
  }
}

const storage: IStorage = isBrowser ? new LocalStorage() : new FileStorage('./storage.json');

// Export the appropriate storage based on environment;
export default storage;
