import {Pager} from "./Pager";
import Collection, {getFilterKey, getSortKey} from "./Collection";
import {ResourceManager} from "./ResourceManager";
import {IResource} from "./interfaces";
import {sleep} from "./utils";

export default class RSet {
    pager: Pager
    collection: Collection
    resMan: ResourceManager
    resourceName: string
    protected _rpp: number
    protected _page: number
    protected _filter: any
    protected _sort: any
    protected _filterKey: string
    protected _sortKey: string
    protected _items: IResource[]

    constructor(resMan: ResourceManager, resourceName: string,
                filter: Record<string, string[]> = {}, sorting: string[] = ['id'],
                rpp: number=25, page: number=1) {
        this.resMan = resMan;
        this.collection = resMan.getCollection(resourceName);
        this.pager = this.collection.getPager(filter, sorting);
        this._filter = filter;
        this._sort = sorting
        this._rpp = rpp;
        this.page = page;
        this.resourceName = resourceName;
    }

    async fetch(): Promise<IResource[]> {
        while (!this.collection.cls) {
            await sleep(50);
        }
        const pks = await this.pager.fetch(this.min, this.max + this.rpp);
        const items = await this.resMan.get(this.resourceName, pks)
        if (items)
            this._items = items.slice(0, this.rpp);
        return this._items;
    }
    setPage(page: number) {
        this._page = page - 1;
        return this;
    }
    setRpp(rpp: number) {
        this._rpp = rpp;
        return this;
    }
    setFilter(filter) {
        const key = getFilterKey(filter)
        if (this._filterKey !== key) {
            this._filterKey = key;
            this._filter = filter
            this.pager = this.collection.getPager(filter, this._sort)
        }
        return this
    }
    setSort(sort: string[]) {
        const key = getSortKey(sort);
        if (this._sortKey !== key) {
            this._sortKey = key
            this._sort = sort
            this.pager = this.collection.getPager(this._filter, this._sort);
        }
        return this;
    }
    get items(): IResource[] {
        // Optimistic case
        const pks = this.pager.get(this.min, this.max)
        if (pks.some(x => x === undefined)) {
            this.pager.require(this.min, this.max + this.rpp)
            return [];
        }
        const items = this.collection.get(...pks);
        if (items.some(x => x === undefined)) {
            return [];
        }
        return items
    }
    get totalCount() {
        return this.pager.totalCount;
    }
    get page(): number {
        return this._page + 1;
    }
    set page(value: number) {
        this.setPage(value);
    }
    get rpp(): number {
        return this._rpp
    }
    set rpp(value: number) {
        this.setRpp(value);
    }
    get filter() {
        return this._filter
    }
    set filter(value: any) {
        this.setFilter(value);
    }
    get sort(): string[] {
        return this._sort;
    }
    set sort(value: string[]) {
        this.setSort(value);
    }
    get min (): number {
        return this._rpp * this._page;
    }

    get max () {
        return this._rpp * (this._page + 1)
    }
}