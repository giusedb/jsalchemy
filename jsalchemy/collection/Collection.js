import 'lodash'
import Index from "./Index.js";
import MultiIndex from "./MultiIndex.js";
import utils from "../utils.js";
import {Many2Many} from "./Many2Many.js";

export default class Collection {
  constructor(touch, cls) {
    this.rows = []; // all records in a single array
    this.indexes = {}; // all indexes organized by field name
    this.touch = touch;  // the Touch object to trigger the "gap-filling" procedure
    if (cls)
      this.cls = cls; // the description-built class
    this.m2m = {};
  }

  get cls() {
    return this._cls;
  }
  set cls(val) {
    this._cls = val;
    this.pk = val.$pk[0]
    this.pkIndex = this.getIndex(this.pk); // the index by primary key
  }

  /**
   * Add a record (`item`) to the `Collection`
   * @param item { Object } the individual object you want to add to the collection
   */
  add(item) {
    this.rows.push(item);
    _(this.indexes)
      .values()
      .filter(x => x.constructor !== Many2Many)
      .forEach(index => index.add.call(index, item));
  }

  /**
   * Create a new single-element `Index` by the `fieldName` you want to add
   * @param fieldName { String }
   */
  addIndex(fieldName) {
    const idx = new Index(fieldName, this)
    idx.reindexAll.call(idx)
    this.indexes[fieldName] = idx;
  }

  /**
   * Create a new multi-element `MultiIndex` by the `fieldName` you want to add
   * @param fieldName { String } the field name
   */
  addMultiIndex(fieldName) {
    const idx = new MultiIndex(fieldName, this)
    idx.reindexAll.call(idx)
    this.indexes[fieldName] = idx;
  }

  /**
   * Delete the record / item from the `Collection` by it's primary key.
   * @param pks { String[] } a list of
   * @returns {unknown[]}
   */
  delete(...pks) {
    const items = pks.map(this.pkIndex.get.bind(this.pkIndex));
    if (items.length) {
      items.forEach(item => {
        _(this.indexes).values().each(index => index.unlink.call(index, item));
      });
    }
    const iPks = _(this.rows).map('$pk').value();
    _(pks).map(iPks.indexOf.bind(iPks))
      .reverse().each(i => this.rows.splice(i, 1));
    return items.filter(Boolean);
  }

  /**
   * Delete a previously created index by the `fieldName` it indexes items
   * @param fieldName { String } the `fieldName` for which the index indexes.
   */
  deleteIndex(fieldName) {
    delete this.indexes[fieldName];
  }

  /**
   * Gets a list of items from the collection by primary keys.
   * @param keys { String[] } the list of primary keys you need your items from
   * @returns { cls[] } Array of items in the same order as they are requested if a key is not found,
   * an undefined object is returned instead
   */
  get(...keys) {
    if (keys.length > 1) {
      return keys.map(this.pkIndex.get.bind(this.pkIndex))
    } else {
      return this.pkIndex.get.call(this.pkIndex, keys[0])
    }
  }

  /**
   * Get or create the index by its `fieldName`
   * @param fieldName the field name you request the index for
   * @returns {*}
   */
  getIndex(fieldName, multi, m2m) {
    if (!(fieldName in this.indexes)) {
      if (m2m)
        this.indexes[fieldName] = new Many2Many(fieldName, this, m2m)
      else if (multi)
        this.indexes[fieldName] = new MultiIndex(fieldName, this);
      else
        this.indexes[fieldName] = new Index(fieldName, this);
      this.indexes[fieldName].reindexAll();
    }
    return this.indexes[fieldName];
  }

  /**
   * Reindex the item in all the indexes based on updated item
   * @param item { Object } the `item` to reindex
   */
  update(item) {
    _(this.indexes).values().filter(x => x.constructor !== Many2Many).forEach(idx => {
      idx.update(item);
    });
  }

  /**
   * Insert several `items` on the collections in bulk and indexes and update all indexes with the new data.
   * Split `items` in newly created and updated and return [new items, updated]
   * @param items {Object[]} the Array of basic objects
   * @returns {[Object[], Object[]]} The arrau of items new items together with the array of updated ones
   */
  bulkInsert(items) {
    const getKey = this.pkIndex.getKey.bind(this.pkIndex);
    const pkIndex = this.pkIndex.idx;
    const pkIdx = Object.fromEntries(items.map(item => [getKey(item), item]));
    const comingKeys = new Set(Object.keys(pkIdx));
    const oldKeys = [];
    const newKeys = [];
    for (let k of comingKeys) {
      (k in pkIndex ? oldKeys : newKeys).push(k);
    }
    const comingItems = newKeys.map(k => orm.reactive(new this.cls(pkIdx[k], {})));
    const yetItems = oldKeys.map(k => [pkIdx[k], pkIndex[k]]);
    yetItems.forEach(([newVal, oldVal]) => {
      const oldRow = oldVal.$row;
      for (let [key, val] of _.differenceWith(_.entries(oldRow), _.entries(newVal), _.isEqual)) {
        console.log(`${key} from "${val}" to "${newVal[key]}".`);
        let ix = this.indexes[key]
        if (ix) {
          ix.move(oldVal, oldVal[key], val)
        }
      }
      oldVal.$init(newVal);
    });
    comingItems.forEach(this.add.bind(this));
    return [comingItems, yetItems];
  }

  bulkUpdate(items) {
    const getKey = this.pkIndex.getKey.bind(this.pkIndex);
    const pkIndex = this.pkIndex.idx;
    const ret = [];
    for (let newVal of items) {
      let key = getKey(newVal)
      let oldVal = pkIndex[key];
      if (oldVal) {
        for (let [key, val] of _(newVal)
            .entries()
            .filter(([k, v]) => k in this.indexes)
            .filter(([k, v]) => oldVal[k] !== v)
            .filter(([k, v]) => k !== this.pk)) {
          this.indexes[key].move(oldVal, oldVal[key], val)
        }
        ret.push(oldVal);
        oldVal.$init(newVal);
      }
    }
    return ret;
  }

  /**
   * Find items in the collection by the `filter`
   * The filter is an Object where the keys are the field names and the keys are the individual value
   * or a list of value.
   * All the fields are formalized with by an "and" operator
   * I.E: a filter as {firstName: 'foo', lastName: 'bar'} look for items where the firstName is
   * "foo" and lastName is "bar".
   * I.E: a filter as {firstName: ['foo', 'foobar'], lastName: 'bar'} look for items where the
   * firstName is either "foo" or "foobar" and lastName is "bar".
   * @param filter {Object} the `filter` as described in the examples above
   * @returns {Object[]} returns an array of items that fits the criteria on the `filter`
   */
  find(filter) {
    filter = Object.fromEntries(_(filter)
      .entries()
      .map(([k, v]) => [k, Array.isArray(v) ? v : [v]]))
    const ret = [];
    if (Object.keys(filter).some(k => k in this.indexes)) {
      let involvedIndexes = _(filter)
        .keys()
        .map(x => this.indexes[x])
        .filter(x => x.constructor === Index);
      if (involvedIndexes.some()) {
        const primeIndex = involvedIndexes.first();
        return _(filter[primeIndex.fieldName])
          .map(primeIndex.get.bind(primeIndex))
          .filter(utils.makeFilter(filter))
          .value();
      }
      involvedIndexes = _(filter)
        .keys()
        .map(x => this.indexes[x])
        .filter(x => x.constructor === MultiIndex);
      if (involvedIndexes.some()) {
        const primeIndex = involvedIndexes.first();
        return _(filter[primeIndex.fieldName])
          .map(primeIndex.get.bind(primeIndex))
          .flatten()
          .filter(utils.makeFilter(filter))
          .value()
      }
      return _(ret).filter(filter);
    }
    return _(this.rows).filter(utils.makeFilter(filter)).value();
  }

  getMissingFilters() {
    return _(this.indexes)
      .values()
      .map('missingFilter')
      .filter(Boolean)
      .value()
  }
}
