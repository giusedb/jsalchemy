const defaultPaging = {
  rpp: 10,
  page: 1,
  sort: ['id'],
};

const records = {};
const totalCounts = {};

export default class RecordSet {
  constructor(resoursceManager, model, filter, name, paging) {
    this.loading = true;
    this.model = model;
    this.name = name;
    this.resMan = resoursceManager;
    this.filter = filter;
    this.paging = Object.assign({}, defaultPaging);
    this.paging = Object.assign(this.paging, paging);
    if (!(model.name in records)) {
      records[model.name] = {};
    }
    this.sortedPks = records[model.name]; // bySortArray
    this.totalCount = 0;
    this.records = [];
    this.load()
  }

  getPagerKey() {
    const filter = Object.keys(this.filter).sort().map(k => `${k}:${this.filter[k]}`)
    const sort = this.paging.sort.join(',');
  }

  async load() {
    // TODO You can use the filter reduction fromm `resourceManager.filterCacher.reduce(modelName, this.filter)`
    const pagerKey = this.getPagerKey();
    if (!(pagerKey in this.sortedPks)) {
      this.sortedPks[pagerKey] = {};
    }
    const boundaries = _([(this.paging.page - 1) * this.paging.rpp, this.paging.page * this.paging.rpp])
      .map(rec => [Math.floor(rec / this.model.rpp) + 1, rec % this.model.rpp])
      .zip()
      .map(0)
      .groupBy(0)
      .entries()
      .map(([page, idx]) => [parseInt(page), _(idx).map(1).value()])
      .value();
    for (let outerPage of _(boundaries).map(0).uniq()) {
      if (!(outerPage in this.sortedPks[pagerKey])) {
        this.loading = true;
        try {
          const paging = {
            rpp: this.model.rpp, page: outerPage, sort: this.paging.sort,
          }
          const result = await this.resMan.verb(this.model.name, 'query', {filter: this.filter, paging});
          this.sortedPks[pagerKey][outerPage] = result.pks;
          this.totalCount = result.totalCount;
        } catch (e) {
          console.error(e)
        } finally {
          this.loading = false;
        }
      }
    }
    const pks = [];
    const lastOuterPage = Math.floor(this.totalCount / this.model.rpp) + 1;
    const lastOuterRecord = this.totalCount % this.model.rpp;
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
      pks.push(...this.sortedPks[pagerKey][page].slice(...range))
    }
    const records = await this.resMan.get(this.model.name, pks);
    this.resMan.emit('recordset-page-' + this.name, records, this.totalCount, this.paging);
    this.records.length = 0;
    this.records.push(...records);
    return records
  }
}

for (let prop of Object.keys(defaultPaging)) {
  Object.defineProperty(RecordSet.prototype, prop, {
    get() {
      return this.paging[prop];
    },
    set(value) {
      this.paging[prop] = value;
      if (prop !== 'page') {
        this.paging.page = 1;
      }
      this.load();
    }
  });
}

global.RecordSet = RecordSet;