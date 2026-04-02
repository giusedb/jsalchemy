import {Pager} from "./Pager";
import Collection, {getFilterKey, getSortKey} from "./Collection";
import {ResourceManager} from "./ResourceManager";
import {IResource} from "./interfaces";
import {arrayEqual, sleep} from "./utils";
import {NamedEventManager} from "./NamedEventManager";

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
    protected prevKeys : string[];
    isComplete: boolean;
    loading: boolean
    evt: NamedEventManager
    on: Function

    constructor(resMan: ResourceManager, resourceName: string,
                filter: Record<string, string[]> = {}, sorting: string[] = ['id'],
                rpp: number=25, page: number=1) {
        this.resMan = resMan;
        this.collection = resMan.getCollection(resourceName);
        this.pager = this.collection.getPager(filter, sorting);
        this.isComplete = this.pager.isComplete;
        this._filter = filter;
        this._sort = sorting
        this._rpp = rpp;
        this.page = page;
        this.resourceName = resourceName;
        this._items = [];
        this.loading = false;
        this.resMan.on('received-' + resourceName, this.refresh.bind(this));
        this.resMan.on('deleted-' + resourceName, this.refresh.bind(this));
        this.resMan.on('pager-unified', this.switchPager.bind(this));
        this.evt = new NamedEventManager()
        this.on = this.evt.on.bind(this.evt);
        this.prevKeys = [];
    }

    switchPager(filter: string, pager: Pager) {
        if (getFilterKey(this.filter) === filter) {
            console.log('RSet switching pager ...')
            this.pager = pager;
        }
        this.isComplete = true;
    }
    refresh(): IResource[] {
        const waitForItem = async (pks) => {
            let items = this.collection.get(...pks);
            while (!items.every(Boolean)) {
                await sleep(50);
                items = this.collection.get(...pks);
            }
            this.push(items);
        }
        waitForItem.bind(this);
        if (this.isComplete) {
            this.pager.sort = this._sort;
        }
        const pks = this.pager.get(this.min, this.max, waitForItem);
        if ((pks !== null) && (!arrayEqual(pks, this.prevKeys))) {
            this.prevKeys = pks;
            const items = this.collection.get(...pks)
            if (items.every(Boolean)) {
                this.push(items);
            } else {
                waitForItem(pks);
            }
        }
        return this._items
    }
    async fetch(): Promise<IResource[]> {
        this.evt.emit('loading', true);
        while (!this.collection.cls) {
            await sleep(50);
        }
        const pks = await this.pager.fetch(this.min, this.max + this.rpp);
        const items = await this.resMan.get(this.resourceName, pks)
        if (items)
            this.push(items.slice(0, this.rpp));
        this.evt.emit('loading', false);
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
    getSyncItems() {
        if (this.isComplete) {
            this.pager.sort = this._sort;
        }
        const pks = this.pager.get(this.min, this.max)
        if (!pks.some(x => x === undefined))
            return null;
        const items = this.collection.get(...pks);
        if (items.some(x => x === undefined))
            return null;
        return items
    }
    push(items: IResource[]) {
        this._items.length = 0;
        this._items.push(...items);
        // console.log('Push items', items);
        this.evt.emit('records', items, this.totalCount);
        return this._items;
    }
    get items(): IResource[] {
        return this.refresh();
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