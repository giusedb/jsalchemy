import {NamedEventManager} from "./events.js";
import utils from './utils.js';

const defaultPaging = {
  rpp: 10,
  page: 1,
  sort: ['id'],
};

const records = {};  // singletone by resource name
const totalCounts = {};
const idPages = {};
const incompletePages = {};

class Pending {
  constructor(item) {
    this.item = item;
    this.min = null;
    this.minPage = null;
    this.max = null;
    this.maxPage = null;
  }
}

function findMin(item, sortFunc, pages, pkIndex, start) {
  let partial = start || [0, 0];
  for (let [p, ids] of _(pages).entries().sortBy(x => parseInt(x[0]))) {
    p = parseInt(p);
    for (let i = 0;i < ids.length; i++) {
      let it = pkIndex[ids[i]]
      if (!it)
        continue
      if (sortFunc(item, it) === 1) {
        partial = [p, i];
      } else {
        return partial;
      }
    }
  }
  return partial;
}

function findMax(item, sortFunc, pages, pkIndex, start) {
  for (let [p, ids] of _(pages).entries().sortBy(x => parseInt(x[0]))) {
    if (parseInt(p) < start[0]) continue;
    for (let i = 0; i < ids.length; i++) {
      let it = pkIndex[ids[i]]
      if (!it) continue
      if (sortFunc(item, it) !== 1) {
        return [parseInt(p), i]
      }
    }
  }
}

class Sorted {
  constructor(recordSet, filter, sort, pagerKey) {
    const pk = recordSet.resource.$pk[0];
    this.pagerKey = pagerKey
    if (!sort.includes(pk) && !sort.includes(`~${pk}`)) {
      sort.push(pk);
    }
    this.recSet = recordSet;
    this.filter = filter;
    this.filterFunc = utils.makeFilter(filter);
    this.sort = sort;
    this.pendings = {};
    this.sortFunc = utils.sortFunction(sort);
  }
  async setPage(page) {
    this.page = page;
    let from = this.recSet.paging.rpp * (page - 1);
    from -= this.pendingShift(from);
    const to = from + this.recSet.paging.rpp
    const pks = await this.getIdPages(from, to);
    return await this.getResource(pks);
  }
  pendingShift(from) {
    return _(this.pendings).values().filter(pending => {
      if (!pending.maxPage) return false;
      return (pending.maxPage * this.recSet.resource.rpp + pending.max < from)
    }).size();
  }
  async getIdPages(from, to) {
    const idPages = this.idPages;
    const iTo = to - 1;
    const fromPage = Math.floor(from / this.recSet.resource.rpp);
    const toPage = Math.floor(iTo / this.recSet.resource.rpp);
    for (let page of [fromPage, toPage]) {
      if (!(page in idPages) || (
        ((idPages[page].length < ((iTo % this.recSet.resource.rpp) + 1)) ||
          (idPages[page].length >= this.recSet.resource.rpp)) &&
        (this.incompletePages.has(page)))) {
        const result = await this.recSet.resMan.verb(
          this.recSet.resource.name, 'query', {
            filter: this.filter,
            paging: {
              rpp: this.recSet.resource.rpp,
              page: page + 1,
              sort: this.sort
            }});
        idPages[page] = result.pks;
        this.incompletePages.delete(page);
        this.recSet.totalCount = result.totalCount;
        // remove extra id records
        if ((page - 1 in idPages) &&
          (idPages[page - 1].length > this.recSet.resource.rpp)) {
          const overRange = idPages[page - 1][this.recSet.resource.rpp + 1];
          const firstItem = idPages[page][0];
          if (overRange !== firstItem) {
            this.recSet.resMan.emit('error', 'Inconsistency detected',
              `last item of the previous page has PK ${overRange}, first item of the current page has PK ${firstItem}`);
          }
          idPages[page - 1].splice(this.recSet.resource.rpp);
          this.incompletePages.add(page - 1);
        }
      }
    }
    const pks = [];
    if (fromPage === toPage) {
      pks.push(...idPages[fromPage].slice(
        from % this.recSet.resource.rpp,
        (iTo % this.recSet.resource.rpp) + 1));
    } else {
      pks.push(...idPages[fromPage].slice(from % this.recSet.resource.rpp));
      pks.push(...idPages[toPage].slice(0, to % this.recSet.resource.rpp));
    }
    return pks
  }
  async getResource(pks) {
    const idPages = this.idPages;
    try {
      let recs = await this.recSet.resMan.get(this.recSet.resource.name, pks);
      const idx = utils.indexBy(recs, '$pk');
      const totalPages = Math.ceil(this.recSet.totalCount / this.recSet.resource.rpp);
      if ((_(idPages).size() === totalPages)) {
        const pkIndex = this.recSet.resMan.collections[this.recSet.resource.name].pkIndex.idx;
        if (_(idPages).values().flatten().every(x => x in pkIndex)) {
          this.recSet.completelyLoaded = true;
        }
      }

      return _(pks).map(pk => idx[pk]).value();
    } catch (e) {
      console.error(e)
    }
  }
  onDelete(pks) {
  }
  onInsert(items) {
    items = items.filter(this.filterFunc);
    const itemIdx = utils.indexBy(items, '$pk');
    const unknownPks = _(items).map('$pk').difference(
      _(this.idPages).values().flatten().value()).value()
    for (let pk of unknownPks) {
      this.pendings[pk] = new Pending(itemIdx[pk]);
    }
    if (unknownPks.length && this.recSet.activeSort === this) {
      this.placePendings();
    }
    this.placePendings();
    this.recSet.events.emit('refresh');
  }
  placePendings() {
    // TODO figure out where to put the pending items
    const idPages = this.idPages;
    const allIds = new Set(_(idPages).values().flatten().value());
    allIds.intersection(new Set(_(this.pendings).keys().map(parseInt))).forEach(pk => {
      delete this.pendings[pk];
    });
    const pkIndex = this.recSet.resMan.collections[this.recSet.resource.name].pkIndex.idx;
    let needRefresh = false;
    for (let pending of _(this.pendings).values()) {
      let min = findMin(pending.item, this.sortFunc, idPages, pkIndex);
      let max = findMax(pending.item, this.sortFunc, idPages, pkIndex, min);
      pending.minPage = min[0];
      pending.min = min[1];
      if (max) {
        pending.maxPage = max[0];
        pending.max = max[1];
        if (
          ((min[0] === 0) && (min[1] === 0)) ||
          ((min[0] === max[0]) && (max[1] === min[1] + 1))
        ) {
          this.idPageInsert(pending);
          delete this.pendings[pending.item.$pk];
        }
      }
    }
    this.setPage(this.page);
  }
  idPageInsert(pending) {
    const idPages = this.idPages;
    let pageIdx = pending.minPage
    let page = idPages[pageIdx];
    page.splice(pending.min + 1, 0, pending.item.$pk);
    while (page.length > this.recSet.resource.rpp) {
      pageIdx++;
      let nextPage = idPages[pageIdx];
      if (nextPage) {
        nextPage.unshift(page.pop());
        page = nextPage;
      } else {
        break;
      }
    }
    // _(idPages).keys()
    //   .filter(x => parseInt(x) > pageIdx).forEach(x => {
    //   delete idPages[x];
    // })
  }
}

Object.defineProperty(Sorted.prototype, 'leftPending', {
  get() {
    return _(this.pendings).values().filter(pending =>
      pending.minPage < this.page || (
        (pending.minPage === this.page) &&
        (pending.min < this.paging.rpp)
      )
    )
  }
});

Object.defineProperty(Sorted.prototype, 'idPages', {
  get() {
    let resourcePages = idPages[this.recSet.resource.name];
    if (!resourcePages) {
      idPages[this.recSet.resource.name] = resourcePages = {};
    }
    let page = resourcePages[this.pagerKey];
    if (!page) {
      resourcePages[this.pagerKey] = page = {};
    }
    return page;
  }
});
Object.defineProperty(Sorted.prototype, 'incompletePages', {
  get() {
    let resourcePages = incompletePages[this.recSet.resource.name];
    if (!resourcePages) {
      incompletePages[this.recSet.resource.name] = resourcePages = {};
    }
    let page = resourcePages[this.pagerKey];
    if (!page) {
      resourcePages[this.pagerKey] = page = new Set();
    }
    return page;
  }
});

export default class RecordSet {
  constructor(resourceManager, resourceName, filter, paging, name, loadCallBack) {
    this.events = new NamedEventManager()
    this.on = this.events.on.bind(this.events)
    this.loading = false;
    this.name = name;
    this.resMan = resourceManager;
    this.filter = filter || {};
    this.paging = Object.assign(Object.assign({}, defaultPaging), paging);
    this.sortedPks = {};
    this.totalCount = 0;
    this.records = []; // visible records on viewport
    this.callBack = loadCallBack;
    this.activeSort = null;
    this.completelyLoaded = false;
    this.resMan.describe(resourceName)
      .then(resource => {
        this.resource = resource;
        this.load();
      });
    this.eventHandlers = [
      resourceManager.on('deleted-' + resourceName + '-pk', this.onDelete.bind(this)),
      resourceManager.on('new-' + resourceName, this.onInsert.bind(this))];
  }
  destroy() {
    console.info(`Destroying the RecordSet`)
    this.eventHandlers.forEach(x => this.resMan.events.unbind.call(this.resMan.events, x));
  }
  onDelete(pks) {
    _(idPages[this.resource.name]).entries().forEach(([key, idPages]) => {
      let deleted = 0;
      let remove = false;
      _(idPages).entries()
        .sortBy(x => parseInt(x[0]))
        .forEach(([page, ids]) => {
          const p = parseInt(page)
          if (remove) {
            delete idPages[page];
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
            if ((p + 1) in idPages) {
              idPages[page].push(...idPages[p + 1].splice(0, deleted));
              if (idPages[p + 1].length === 0) {
                delete idPages[p + 1];
              }
            } else {
              remove = true;
            }
          }
          if (ids.length < this.resource.rpp) {
            this.incompletePages(this.resource.name, key).add(p);
          }
        });
    });

    // _(this.sortedPks).values().forEach(x => x.onDelete(pks));
    this.totalCount -= pks.size;
    this.load();
    this.events.emit('refresh');
  }
  incompletePages(resourceName, key) {
    let pages = incompletePages[resourceName];
    if (!pages) {
      incompletePages[resourceName] = pages = {};
    }
    let page = pages[key];
    if (!page) {
      pages[key] = page = new Set();
    }
    return page;
  }
  onInsert(items) {
    console.info(`Insert ${items.length} records into ${this.resource.name}`);
    _(this.sortedPks).values().forEach(x => x.onInsert(items));
    // this.totalCount += items.length;
    this.load();
  }
  getPagerKey() {
    const filter = Object.keys(this.filter).sort().map(k => `${k}:${this.filter[k]}`)
    const sort = this.paging.sort.join(':');
    return `${filter.join(':')}|${sort}`;
  }
  async load() {
    this.events.emit('loading', true);
    try {
      const key = this.getPagerKey();
      if (!(key in this.sortedPks)) {
        this.sortedPks[key] = new Sorted(this, Object.assign({}, this.filter), [...this.paging.sort], key);
      }
      this.activeSort = this.sortedPks[key];
      const recs = await this.sortedPks[key].setPage(this.paging.page);
      this.resMan.emit('recordset-page-' + this.name, recs, this.totalCount, this.paging);
      this.records.length = 0;
      this.records.push(...recs);
      if (this.callBack) {
        this.callBack(recs, this.totalCount, this.paging);
      }
      this.events.emit('records', recs, this.totalCount, this.paging);
      return recs
    } catch (e) {
      this.resMan.emit('error', e)
    } finally {
      this.events.emit('loading', false);
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

