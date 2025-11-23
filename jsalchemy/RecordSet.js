import {NamedEventManager} from "./events.js";

const defaultPaging = {
  rpp: 10,
  page: 1,
  sort: ['id'],
};

const records = {};
const totalCounts = {};

export default class RecordSet {
  constructor(resourceManager, resourceName, filter, name, paging, loadCallBack) {
    this.events = new NamedEventManager()
    this.on = this.events.on.bind(this.events)
    this.loading = false;
    this.name = name;
    this.resMan = resourceManager;
    this.filter = filter;
    this.paging = Object.assign({}, defaultPaging);
    this.paging = Object.assign(this.paging, paging);
    if (!(resourceName in records)) {
      records[resourceName] = {};
    }
    this.sortedPks = records[resourceName]; // bySortArray
    this.totalCount = 0;
    this.records = [];
    this.callBack = loadCallBack;
    this.resMan.describe(resourceName)
      .then(resource => {
        this.resource = resource;
        this.load();
      });
    resourceManager.on('deleted-' + resourceName + '-pk', this.onDelete.bind(this))
    resourceManager.on('new-' + resourceName, this.onInsert.bind(this))
  }

  onDelete(pks) {
    let deleted = 0
    console.info(`Deleted ${pks.length} records from ${this.resource.name}`)
    _(this.sortedPks)
      .values()
      .forEach(
      largePages => {
        let deleted = 0;
        let remove = false;
        _(largePages)
          .entries()
          .sortBy(x => parseInt(x[0])).forEach(
          ([page, ids]) => {
            const p = parseInt(page)
            if (remove) {
              delete largePages[page];
              return
            }
            for (let i = 0; i < ids.length; i++) {
              if (pks.has(ids[i])) {
                deleted++;
                ids.splice(i, 1);
                i--;
              }
            }
            if (deleted) {
              if ((p + 1) in largePages) {
                largePages[page].push(...largePages[p + 1].splice(0, deleted));
                if (largePages[p + 1].length === 0) {
                  delete largePages[p + 1];
                }
              } else {
                remove = true;
              }
            }
        });
        this.totalCount -= deleted;
      })

    const diff = new Set(_(this.records).map('$pk')).intersection(pks);
    if (diff.size) {
      this.load();
    }
    console.log(this.sortedPks[this.getPagerKey()])
  }

  onInsert(items) {
    console.info(`Insert ${items.length} records from`)
  }

  getPagerKey() {
    const filter = Object.keys(this.filter).sort().map(k => `${k}:${this.filter[k]}`)
    const sort = this.paging.sort.join(',');
  }

  getBoundaries() {
    return _([(this.paging.page - 1) * this.paging.rpp, this.paging.page * this.paging.rpp])
      .map(rec => [Math.floor(rec / this.resource.rpp) + 1, rec % this.resource.rpp])
      .zip()
      .map(0)
      .groupBy(0)
      .entries()
      .map(([page, idx]) => [parseInt(page), _(idx).map(1).value()])
      .value();
  }

  async load() {
    this.events.emit('loading', true);
    try {
      await this.loadPKs();
      return await this.loadResource();
    } catch (e) {
      this.resource.emit('error', e)
    } finally {
      this.events.emit('loading', false);
    }
  }

  async loadPKs() {
    // TODO You can use the filter reduction fromm `resourceManager.filterCacher.reduce(modelName, this.filter)`
    if (!this.resource) {
      return;
    }
    const pagerKey = this.getPagerKey();
    if (!(pagerKey in this.sortedPks)) {
      this.sortedPks[pagerKey] = {};
    }
    const boundaries = this.getBoundaries();
    for (let outerPage of _(boundaries).map(0).uniq()) {
      if (!(outerPage in this.sortedPks[pagerKey]) ||
        ((this.sortedPks[pagerKey][outerPage].length < this.resource.rpp)) &&
        (outerPage < Math.floor(this.totalCount / this.resource.rpp) + 1)) {
        try {
          const paging = {
            rpp: this.resource.rpp, page: outerPage, sort: this.paging.sort,
          }
          const result = await this.resMan.verb(this.resource.name, 'query', {filter: this.filter, paging});
          this.sortedPks[pagerKey][outerPage] = result.pks;
          this.totalCount = result.totalCount;
        } catch (e) {
          console.error(e)
        }
      }
    }
  }

  async loadResource() {
    const boundaries = this.getBoundaries();
    const pagerKey = this.getPagerKey();
    const pks = [];
    const lastOuterPage = Math.floor(this.totalCount / this.resource.rpp) + 1;
    const lastOuterRecord = this.totalCount % this.resource.rpp;
    if (Object.keys(boundaries).length > 1) {
      if (boundaries[0][0] > lastOuterPage) { return [] }
      if ((boundaries[0][0] === lastOuterPage) && (boundaries[0][1][0] >= lastOuterRecord)) { return [] }
      pks.push(...this.sortedPks[pagerKey][boundaries[0][0]]
        .slice(boundaries[0][1][0]))
      pks.push(...this.sortedPks[pagerKey][boundaries[1][0]]
        .slice(0, boundaries[1][1][0]))
    } else {
      const [page, range] = boundaries[0]
      if (page > lastOuterPage) { return [] }
      if ((page === lastOuterPage) && (range[0] >= lastOuterRecord)) { return [] }
      pks.push(...this.sortedPks[pagerKey][page].slice(...range));
    }
    try {
      let recs = await this.resMan.get(this.resource.name, pks);
      this.resMan.emit('recordset-page-' + this.name, recs, this.totalCount, this.paging);
      this.records.length = 0;
      this.records.push(...recs);
      if (this.callBack) {
        this.callBack(recs, this.totalCount, this.paging);
      }
      this.events.emit('results', recs, this.totalCount, this.paging);
      return recs
    } catch (e) {
      console.error(e)
    }
  }
}

for (let prop of Object.keys(defaultPaging)) {
  Object.defineProperty(RecordSet.prototype, prop, {
    get() {
      return this.paging[prop];
    },
    set(value) {
      if (value === this.paging[prop]) { return; }
      this.paging[prop] = value;
      if (prop !== 'page') {
        this.paging.page = 1;
      }
      this.events.emit('paging', this.paging);
      this.load();
    }
  });
}

global.RecordSet = RecordSet;