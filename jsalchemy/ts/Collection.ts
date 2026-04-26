import {
    FilterFunction,
    IGotDataOptions, IPager,
    IQueryFilter, IQueryResult,
    IResource,
    IResourceClass,
    IResourceDef,
    ISort
} from "./interfaces";
import {Pager} from "./Pager";
import utils from "../utils";
import Toucher from "./Toucher";
import {ResourceManager} from "./ResourceManager";
import _ from "lodash";
import {indexMap} from "./utils";
import DeferredFetcher from "./DeferredFetcher";
import {SimplePager} from "./SimplePager";

const MAX_PAGER_LENGTH = 50;

export function getFilterKey(filter: Object) {
    return Object.keys(filter)
        .sort()
        .map(k => `${k}:${filter[k]}`).join(':');
}

export function getSortKey(sort: Array<string>) {
    return sort.join(':');
}

interface IPendingQuery {
    resolve: (value: T[]) => void;
    reject: (reason?: any) => void;
    query: IQueryFilter;
}

class DeferredQueryFetcher {
    private queue: IPendingQuery[] = [];

    constructor(private readonly resMan: ResourceManager,
                private readonly collection: Collection,
                private readonly interval: number = 50) {
        setInterval(this.processQueue.bind(this), this.interval);
    }

    public fetch(query: IQueryFilter): Promise<IQueryResult> {
        return new Promise((resolve, reject) => {
            this.queue.push({ resolve, reject, query})
        })
    }

    private async processQueue() {
        const currentQueue = [...this.queue];
        this.queue = [];

        if (currentQueue.length === 0) return;

        if (currentQueue.length === 1) {
            const result = await this.resMan.verb(this.collection.cls.name, 'query',
                currentQueue[0].query, true);
            currentQueue[0].resolve(result);
        } else {
            const result = await this.resMan.verb(this.collection.cls.name, 'query',
                {multiple: currentQueue.map(req => req.query)}, true)
            for (let i = 0; i < result.length; i++) {
                currentQueue[i].resolve(result[i]);
            }
        }
    }
}

class Collection {
    pkIndex: Map<string, IResource>
    cls: IResourceClass
    touch: Toucher
    pagers: Map<string, ISort>
    filterFuncs: Map<string, FilterFunction>
    filters: Map<string, Object>
    resMan: ResourceManager

    // missing
    missing: Set<string>
    requested: Set<string>
    loading: Promise<any>
    fetcher: DeferredFetcher<IResource>
    deferreQuery: DeferredQueryFetcher;
    reactive: (item: IResource) => IResource;

    constructor(resMan: ResourceManager, touch: Toucher, cls: IResourceClass, loading: Promise<any>) {
        this.pkIndex = new Map()
        this.cls = cls
        this.touch = touch
        this.pagers = new Map();
        this.filterFuncs = new Map<string, FilterFunction>();
        this.filters = new Map<string, Object>();
        this.missing = new Set()
        this.requested = new Set()
        this.resMan = resMan;
        this.loading = loading;
        this.fetcher = new DeferredFetcher(async (pks: string[]) => {
            await this.resMan.verb(this.cls.name, 'get', { pks });
            pks.forEach(x => this.requested.add(x));
            return pks.map(pk => this.pkIndex.get(pk));
        }, 50, '$pk');
        this.deferreQuery = new DeferredQueryFetcher(resMan, this);
        if (resMan.options.uiFramework === 'vue') {
            const ref = resMan.options.reactiveFunc;
            this.reactive = (item: IResource) => {
                return ref(item).value
            }
        } else if (resMan.options.uiFramework === 'react') {

        }
        else
            this.reactive = (item: IResource) => item;
    }

    add(item: IResource) {
        this.pkIndex.set(item.$pk, item)
        this.filterFuncs.forEach((func, fk, map) => {
            if (func(item)) {
                this.pagers.get(fk).pagers.forEach(pager => {
                    pager.add([item]);
                })
            }
        })
    }
    update(item: IResource) {
        const old = this.pkIndex.get(item.$pk)
        const getPk = this.cls.getPk;
        this.pagers.forEach((sort, fk, map) => {
            let func = this.filterFuncs.get(fk);
            let oldIn = func(old)
            let newIn = func(item)
            if (oldIn && !newIn) {
                sort.pagers.forEach((pager) => {
                    pager.remove([getPk(item)]);
                });
            } else if (!oldIn && newIn) {
                sort.pagers.forEach((pager) => {
                    pager.add([item]);
                })
            }
        });
    }
    delete(...pks: string[]): IResource[] {
        const ret: IResource[] = []
        this.pagers.forEach((sort, i) => {
            sort.totalCount -= Math.max(...sort.pagers.values()
                .map(pager => pager.remove(pks)))
        })
        for (const pk of pks) {
            if (this.pkIndex.has(pk))
                ret.push(this.pkIndex.get(pk))
            this.pkIndex.delete(pk)
        }
        return ret;
    }
    async get(...keys: string[]): Promise<IResource[]> {
        // console.log(`Collection.getAsync(${keys})`)
        const keySet = new Set(keys);
        const missing = keySet.difference(new Set(this.pkIndex.keys()));
        missing.forEach(x => this.requested.add(x))
        if (missing.size) {
            const fetched = await this.fetcher.fetch(Array.from(missing));
            // console.log('Fetched', fetched);
        }
        return keys.map(x => this.pkIndex.get(x))
    }
    bulkInsert(items: IResource[], hydratePagers: boolean = false, options: IGotDataOptions): [IResource[], any[]] {
        const getKey = this.cls.getPk;
        const idxPk: Map<string, IResource> = indexMap(items, getKey);
        const oldKeys = [];
        const newKeys = [];
        for (const key of idxPk.keys()) {
            if (this.pkIndex.has(key)) {
                oldKeys.push(key);
            } else {
                newKeys.push(key);
            }
        }
        let newItems: IResource[]
        if (options.dontCreate) {
            for (let i = 0; i < options.savedItems.length; i ++) {
                options.savedItems[i].$init(items[i]);
            }
            newItems = options.savedItems;
        }
        else
            newItems = newKeys.map(k => this.reactive(new this.cls(idxPk.get(k), {})));
        let existingItems: [IResource, object][] = oldKeys.map(k => {
            const oldItem = this.pkIndex.get(k);
            const newItem = idxPk.get(k);
            const diff = Object.fromEntries(
                Object.entries(oldItem.$row)
                    .filter(([k, v]) => v !== newItem[k]));
            return [oldItem, diff]
        })
        const existingPks = new Set(existingItems.map(([i]) => i.$pk));
        newItems.forEach(item => this.pkIndex.set(item.$pk, item))
        newItems = newItems.filter(item => !existingPks.has(item.$pk));
        existingItems = existingItems.filter(([_, diff]) => Object.keys(diff).length);
        if (hydratePagers) {
            for (let [filterKey, sort] of this.pagers.entries()) {
                let filtered = newItems.filter(this.filterFuncs.get(filterKey));
                if (filtered.length) {
                   sort.totalCount += filtered.length;
                    for (let pager of sort.pagers.values()) {
                        pager.add(filtered);
                    }
                }
            }
        }
        if (existingItems.length) {
            this.bulkUpdate(existingItems);
        }

        return [newItems, existingItems]
    }
    bulkUpdate(items: [IResource, object][]): IResource[] {
        const getPk = this.cls.getPk;
        const ret = [];
        const oItems = items.map(([newStatus, oldStatus]) => {
            const pk = getPk(newStatus);
            let oldItem = this.pkIndex.get(pk);
            if (oldItem) {
                oldItem.$init(newStatus)
                ret.push(oldItem);
            } else {
                oldItem = this.reactive(new this.cls(newStatus));
                this.pkIndex.set(pk, oldItem);
            }
            return [oldItem, oldStatus];
        })
        for (let [filterKey, sort] of this.pagers.entries()) {
            if (filterKey === '') continue
            let toRemove: IResource[] = [];
            let toAdd: IResource = [];
            let filterSet = new Set(Object.keys(this.filters.get(filterKey)));
            let filterFunc = this.filterFuncs.get(filterKey);
            for (let [oldItem, partial] of oItems) {
                if (new Set(Object.keys(partial)).intersection(filterSet).size)
                    (filterFunc(partial) ? toRemove : toAdd).push(oldItem);
            }
            if (toAdd.length) {
                sort.totalCount += toAdd.length
                for (let pager of sort.pagers.values()) {
                    pager.add(toAdd);
                }
            }
            if (toRemove.length) {
                sort.totalCount -= toRemove.length
                for (let pager of sort.pagers.values()) {
                    pager.remove(toRemove.map(getPk))
                }
            }
        }
        return ret
    }
    find(filter: Map<string, Array<any>>): Array<IResource> {
        const filterFunc = utils.makeFilter(filter);
        return Array.from(this.pkIndex.values().filter(filterFunc));
    }
    getMissingFilters(): Array<string> | null {
        if (this.missing.size === 0)
            return null;
        const ret = Array.from(this.missing.values());
        this.missing.clear();
        return ret;
    }
    get missingQueries(): [Pager, number][] {
        const ret = []
        for (let [filterKey, iSort] of this.pagers.entries()) {
            for (let [sortKey, pager] of iSort.pagers.entries()) {
                if (pager.requiredPages.length) {
                    ret.push(...pager.missingPages)
                }
            }
        }
        return ret
    }
    async getPager(filter: Record<string, string[]>, sort: Array<string> = ['~id']): Promise<IPager> {
        const filterKey = getFilterKey(filter)
        const sortKey = getSortKey(sort)
        if (!this.pagers.has(filterKey)) {
            this.pagers.set(filterKey, { totalCount: null, pagers: new Map(), isComplete: false });
            this.filterFuncs.set(filterKey, utils.makeFilter(filter))
            this.filters.set(filterKey, filter);
        }
        const iSort = this.pagers.get(filterKey)
        if (iSort.isComplete) {
            return iSort.pagers.get('');
        }
        if (!iSort.pagers.has(sortKey)) {
            let pager: IPager;
            if (!this.cls)
                await this.loading
            const queryResult = await this.deferreQuery.fetch(this.queryArgs(filter, sort, 0));
            if (queryResult.totalCount < Math.max(this.cls.rpp, MAX_PAGER_LENGTH)) {
                if (queryResult.pks.length) {
                    await this.get(...queryResult.pks);
                }
                pager = new SimplePager(this, filter, sort, queryResult.pks);
            } else {
                pager = new Pager(this, filter, sort)
                pager.pages.set(0, queryResult.pks);
            }
            iSort.pagers.set(sortKey, pager)
            iSort.totalCount = queryResult.totalCount;
        }
        return iSort.pagers.get(sortKey);
    }
    queryArgs(filter: any, sort: string[], nPage: number): IQueryFilter {
        return {
            filter,
            paging: {
                rpp: this.cls.rpp,
                page: nPage,
                sort: sort
            }
        }
    }
}

export default Collection