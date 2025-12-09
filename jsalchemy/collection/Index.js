export default class Index {
  constructor(fieldName, collection) {
    if (collection.cls)
      console.log(`creating single index for ${collection.cls.name}.${fieldName}`)
    else
      console.log(`creating single index for unknown.${fieldName}`)
    this.collection = collection;
    this.fieldName = fieldName;
    this.idx = {};
    this.missing = new Set();
    this.requested = new Set();
  }

  reindexAll() {
    const idx = {};
    const getKey = this.getKey;
    for (let item of this.collection.rows) {
      idx[getKey.call(this, item)] = item;
    }
    this.idx = idx;
  }

  add(item) {
    this.idx[this.getKey(item)] = item;
  }

  get(key) {
    const ret = this.idx[key];
    if ((ret === undefined) && (!this.requested.has(key))){
      this.missing.add(key);
      this.collection.touch.touch();
    }
    return ret;
  }

  getKey(item) {
    return item[this.fieldName];
  }

  unlink(item) {
    if (item)
      delete this.idx[this.getKey(item)];
  }

  update(item) {
    const oldKey = this.getKey(item.$row)
    const newKey = this.getKey(item);
    if (oldKey !== newKey) {
      this.idx[newKey] = this.idx[oldKey];
      delete this.idx[oldKey];
    }
  }

  move(item, oldKey, newKey) {
    console.log(this.idx, oldKey, newKey)
    this.idx[newKey] = item;
    delete this.idx[oldKey];
  }

  get missingFilter() {
    if (this.missing.size === 0)
      return null;
    const ret = {};
    ret[this.fieldName] = [...this.missing];
    this.requested = this.requested.union(this.missing);
    this.missing.clear();
    return ret
  }

  /**
   * Returns the number of keys in the index.
   * @returns {Number}
   */
  get size() {
    return Object.keys(this.idx).length
  }
}
