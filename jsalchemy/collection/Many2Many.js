
export class Many2Many {
  constructor(fieldName, collection) {
    if (collection.cls)
      console.log(`creating mtm index for ${collection.cls.name}.${fieldName}`)
    else
      console.log(`creating mtm index for unknown.${fieldName}`)
    this.fieldName = fieldName;
    this.collection = collection;
    this.idx = {};
    this.missing = new Set();
    this.requested = new Set();
  }

  get(key) {
    if (!(key in this.idx)) {
      this.idx[key] = new Set();
      this.missing.add(key);
      this.collection.touch.touch();
    }
    return this.idx[key];
  }

  add(locRemote) {
    const [local, remotes] = locRemote;
    if (!(local in this.idx))
      this.idx[local] = new Set(remotes);
    else {
      remotes.map(this.idx[local].add.bind(this.idx[local]));
    }
  }

  del(locRemote) {
    const [local, remotes] = locRemote;
    if (local in this.idx) {
      remotes.forEach(this.idx[local].delete.bind(this.idx[local]));
    }
  }

  reindexAll() {}

  move(item, oldKey, newKey) {

  }
  get missingFilter() {
    if (this.missing.size === 0)
      return null;
    const ret = {
      attribute: this.fieldName,
      method: 'get',
      keys: [...this.missing],
    };
    this.requested = this.requested.union(this.missing);
    this.missing.clear();
    return [ret, this.collection.cls.references[this.fieldName]];
  }

  /**
   * Returns the number of keys in the index.
   * @returns {Number}
   */
  get size() {
    return Object.keys(this.idx).length
  }

}
