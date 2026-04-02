import {FilterFunction, IGotDataOptions, IResource, IResourceClass, IResourceDef, ISort} from "./interfaces";
import {Pager} from "./Pager";
import utils from "../utils";
import Toucher from "./Toucher";
import {ResourceManager} from "./ResourceManager";
import _ from "lodash";

export function getFilterKey(filter: Object) {
    return Object.keys(filter)
        .sort()
        .map(k => `${k}:${filter[k]}`).join(':');
}

export function getSortKey(sort: Array<string>) {
    return sort.join(':');
}

class Collection {
    pkIndex: Map<string, IResource>
    _cls: IResourceClass
    touch: Toucher
    pagers: Map<string, ISort>
    filterFuncs: Map<string, FilterFunction>
    resMan: ResourceManager

    // missing
    missing: Set<string>
    requested: Set<string>

    constructor(resMan: ResourceManager, touch: Toucher, cls: IResourceClass) {
        this.pkIndex = new Map()
        this._cls = cls
        this.touch = touch
        this.pagers = new Map();
        this.filterFuncs = new Map<string, FilterFunction>();
        this.missing = new Set()
        this.requested = new Set()
        this.resMan = resMan;
    }

    get cls(): IResourceClass {
        return this._cls;
    }

    set cls(val: IResourceClass) {
        this._cls = val
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
    get(...keys: string[]): IResource[] {
        const keySet = new Set(keys);
        const missing = keySet.difference(new Set(this.pkIndex.keys()).union(this.requested));
        missing.forEach(x => this.requested.add(x))
        if (missing.size) {
            for (let item of missing) {
                this.requested.add(item);
                this.missing.add(item);
            }
            this.touch.touch();
        }
        return keys.map(x => this.pkIndex.get(x))
    }
    bulkInsert(items: IResource[], hydratePagers: boolean = false, options: IGotDataOptions): [IResource[], any[]] {
        const getKey = this.cls.getPk;
        const idxPk = Object.fromEntries(items.map(x => [getKey(x), x]))
        const oldKeys = [];
        const newKeys = [];
        for (const key in idxPk) {
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
            newItems = newKeys.map(k => new this.cls(idxPk[k], {}));
        const existingItems: [IResource, object][] = oldKeys.map(k => {
            return [this.pkIndex.get(k), idxPk[k]]
        })
        newItems.forEach(item => this.pkIndex.set(item.$pk, item))
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
        this.bulkUpdate(existingItems);
        return [newItems, existingItems]
    }
    bulkUpdate(items: [IResource, object][]): IResource[] {
        const getPk = this.cls.getPk;
        const ret = [];
        for (let [filterKey, sort] of this.pagers.entries()) {
            let toRemove = [];
            let toAdd = [];
            let filterFunc = this.filterFuncs.get(filterKey);
            for (let item of items) {
                (filterFunc(item) ? toAdd : toRemove).push(item);
            }
            if (toAdd.length) {
                sort.totalCount += toAdd.length
                for (let pager of sort.pagers.values()) {
                    pager.add(toAdd);
                }
            }
            if (toRemove.length) {
                // sort.totalCount -= toRemove.length
                for (let pager of sort.pagers.values()) {
                    pager.remove(toRemove)
                }
            }
        }
        for (let item of items) {
            let pk = getPk(item);
            let oldItem = this.pkIndex.get(pk);
            if (oldItem) {
                oldItem.$init(item)
                ret.push(oldItem);
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
    getPager(filter: Record<string, string[]>, sort: Array<string> = ['~id']): Pager {
        const filterKey = getFilterKey(filter)
        const sortKey = getSortKey(sort)
        if (!this.pagers.has(filterKey)) {
            this.pagers.set(filterKey, { totalCount: null, pagers: new Map(), isComplete: false });
            this.filterFuncs.set(filterKey, utils.makeFilter(filter))
        }
        const iSort = this.pagers.get(filterKey)
        if (iSort.isComplete) {
            return iSort.pagers.get('');
        }
        if (!iSort.pagers.has(sortKey)) {
            iSort.pagers.set(sortKey, new Pager(this, filter, sort));
        }
        return iSort.pagers.get(sortKey);
    }

    get allPagers(): Pager[] {
        const ret = [];
        for (let sort of this.pagers.values()) {
            for (let p of sort.pagers.values()) {
                ret.push(p);
            }
        }
        return ret;
    }
}

export default Collection