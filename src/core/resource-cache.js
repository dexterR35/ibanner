/** Share in-flight decodes, then retain a bounded LRU of decoded resources. */
export class ResourceCache {
  constructor({ maxEntries = 8, maxBytes = 96 * 1024 * 1024 } = {}) {
    this.entries = new Map();
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }
  get(key, load) {
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.promise;
    }
    const entry = { bytes: 0, promise: null };
    entry.promise = Promise.resolve()
      .then(load)
      .then(
        (value) => {
          entry.bytes =
            (value.naturalWidth || value.width || 0) *
            (value.naturalHeight || value.height || 0) *
            4;
          this.trim();
          return value;
        },
        (error) => {
          if (this.entries.get(key) === entry) this.entries.delete(key);
          throw error;
        },
      );
    this.entries.set(key, entry);
    this.trim();
    return entry.promise;
  }
  trim() {
    let bytes = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries && bytes <= this.maxBytes) break;
      this.entries.delete(key);
      bytes -= entry.bytes;
    }
  }
}
