import {Pager} from "./Pager";
import Collection, {getFilterKey, getSortKey} from "./Collection";
import {ResourceManager} from "./ResourceManager";
import {IResource} from "./interfaces";
import {arrayEqual, sleep} from "./utils";
import {NamedEventManager} from "./NamedEventManager";

export default class RSet {
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
    protected _pager: Pager
    protected _isComplete: boolean
    protected prevKeys : string[];
    protected waitForPager: Promise<Pager> = null
    loading: boolean
    evt: NamedEventManager
    on: Function
    eventIds: number[]

    constructor(resMan: ResourceManager, resourceName: string,
                filter: Record<string, string[]> = {}, sorting: string[] = ['id'],
                rpp: number=25, page: number=1) {
        this.resMan = resMan;
        this.collection = resMan.getCollection(resourceName);
        this._pager = null;
        this._filter = filter;
        this._sort = sorting
        this._rpp = rpp;
        this.page = page;
        this.resourceName = resourceName;
        this._items = [];
        this.loading = false;
        this.eventIds = [];
        this.eventIds.push(this.resMan.on('received-' + resourceName, this.refresh.bind(this)));
        this.eventIds.push(this.resMan.on('deleted-' + resourceName, this.refresh.bind(this)));
        this.eventIds.push(this.resMan.on('pager-unified', this.switchPager.bind(this)));
        this.evt = new NamedEventManager()
        this.prevKeys = [];
        if (resMan.options.uiFramework === 'vue') {
            this._items = resMan.options.reactiveFunc([]).value;
        }
    }
    dispose() {
        this.eventIds.forEach(id => this.resMan.events.unbind(id));
    }

    switchPager(filter: string, pager: Pager) {
        if (getFilterKey(this.filter) === filter) {
            // console.log('RSet switching pager ...')
            this._pager = pager;
            this._isComplete = true;
        }
    }
    refresh(): IResource[] {
        this.fetch();
        return this._items
    }
    async fetch(): Promise<IResource[]> {
        // console.log('Rset.fetch()')
        this.evt.emit('loading', true);
        let pager = this.pager
        if (this.waitForPager)
            pager = await this.waitForPager
        const pks = await pager.get(this.min, this.max + this.rpp);
        if ((pks !== null) && (!arrayEqual(pks, this.prevKeys))) {
            const items = await this.resMan.get(this.resourceName, pks)
            if (items)
                this.push(items.slice(0, this.rpp));
            this.evt.emit('loading', false);
            this.prevKeys = items.map(this.collection.cls.getPk);
        }
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
            this._pager = null;
        }
        return this
    }
    setSort(sort: string[]) {
        const key = getSortKey(sort);
        if (this._sortKey !== key) {
            this._sortKey = key;
            this._sort = sort;
            (async () => {
                if (this.waitForPager) return;
                this.waitForPager = this.collection.getPager(this.filter, this._sort)
                this._pager = await this.waitForPager
                this.waitForPager = null
            })();            
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
        if (!this.pager)
            return 0;
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
    get pager(): Pager | null {
        if (this._pager)
            return this._pager;
        (async () => {
            if (this.waitForPager) return;
            this.waitForPager = this.collection.getPager(this.filter, this._sort)
            this._pager = await this.waitForPager
            this.waitForPager = null
        })();
        return null;
    }
    get isComplete(): boolean {
        if (this._isComplete)
            return this._isComplete
        if (this._pager) {
            return this._pager.isComplete;
        }
        return false;
    }
}