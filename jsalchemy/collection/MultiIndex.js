export default class MultiIndex {
  constructor(fieldName, collection) {
    if (collection.cls)
      console.log(`creating multi index for ${collection.cls.name}.${fieldName}`);
    else
      console.log(`creating multi index for unknown.${fieldName}`);
    this.collection = collection;
    this.fieldName = fieldName;
    this.idx = {};
    this.missing = new Set();
    this.requested = new Set();
  }

  reindexAll() {
    const idx = this.idx;
    Object.keys(idx).forEach(x => delete idx[x]);
    const getIdx = this.getIdx.bind(this);
    for (let item of this.collection.rows) {
      getIdx(item).push(item);
    }
  }
  getIdx(item) {
    const key = this.getKey(item);
    if (!(key in this.idx)) {
      this.idx[key] = [];
    }
    return this.idx[key];
  }
  add(item) {
    this.getIdx(item).push(item);
  }
  get(key) {
    if (!this.requested.has(key)) {
      this.missing.add(key);
    }
    if (!(key in this.idx)) {
      //TODO make the reactive optional and propagate it through the constructors
      this.idx[key] = window.orm.reactive([]);
      this.collection.touch.touch();
    }
    return this.idx[key];
  }
  getKey(item) {
    return item[this.fieldName];
  }
  unlink(item) {
    const idx = this.getIdx(item);
    const pk = this.collection.cls.$pk[0];
    const i = idx.map(x => x[pk]).indexOf(item[pk]);
    if (i >= 0) {
      idx.splice(i, 1);
    }
  }
  update(item) {
    // TODO this can be optimized by keeping the previous references
    let ref, val, idx = null;
    for ([ref, val] of Object.entries(this.idx)) {
      if (val.includes(item)) {
        idx = val.indexOf(item);
        if (idx != -1)
          break;
      }
    }
    const key = this.getKey(item);
    if (item[key] !== ref) {
      if (ref) {
        this.get(key).push(this.idx[ref].splice(idx, 1)[0]);
      }
      else
        this.get(key).push(item);
    }
  }
  move(item, oldKey, newKey) {
    const i = _(this.idx[oldKey] || [])
      .map(this.getKey.bind(this.collection.pkIndex)).value()
      .indexOf(this.getKey.call(this.collection.pkIndex, item))
    if (i !== -1) {
      this.idx[oldKey].splice(i, 1);
      if (this.idx[oldKey].length === 0) {
        delete this.idx[oldKey];
      }
    } else {
      console.error('old key not found')
    }
    if (!(newKey in this.idx)) {
      this.idx[newKey] = [];
    }
    this.idx[newKey].push(item);
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
