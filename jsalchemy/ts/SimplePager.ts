import {FilterFunction, IPager, IQueryFilter, IQueryResult, IResource, SortFunction} from "./interfaces";
import Collection, {getFilterKey, getSortKey} from "./Collection";
import {ResourceManager} from "./ResourceManager";
import {makeFilter, makeSortFunction} from "./utils";
import {Pager} from "./Pager";

export class SimplePager implements IPager {
    page: string[];
    collection: Collection
    resMan: ResourceManager
    filter: Record<string, string[]>
    filterKey: string
    filterFunc: FilterFunction
    _sort: string[]
    sortKey: string
    sortFunc: SortFunction
    rpp: number;
    sorted: Array<string>;
    isComplete: boolean;
    requiredPages: [number, Pager][];


    constructor (collection: Collection, filter: Record<string, string[]>, sort: string[], page: string[]) {
        this.collection = collection
        this.resMan = collection.resMan
        this.filter = filter;
        this._sort = sort;
        this.filterKey = getFilterKey(this.filter);
        this.filterFunc = makeFilter(filter);
        this.sortKey = getSortKey(sort);
        this.sortFunc = makeSortFunction(sort);
        this.rpp = this.collection.cls.rpp;
        this.sorted = page;
        this.reSort();
        this.requiredPages = [];
    }
    async get(min: number, max: number, callBack?: Function): Promise<string[]> {
        return this.sorted.slice(min, max);
    }
    private reSort() {
        const pkIdx = this.collection.pkIndex
        const srt = (x, y) => this.sortFunc(pkIdx.get(x), pkIdx.get(y))
        this.sorted = this.page.sort(srt);
    }
    get totalCount() {
        return this.collection.pagers.get(this.filterKey).totalCount
    }
    add(items: IResource[]): void {
        // maybe sorted insert would be better
        const pks = items.map(this.collection.cls.getPk)
            .filter(x => !this.page.includes(x));
        if (pks.length) {
            this.page.push(...pks)
            this.reSort();
        }
    }
    async fetch(min: number, max: number): Promise<string[]> {
        return this.get(min, max);
    }

    hasInterval(min: number, max: number): boolean {
        return true;
    }

    remove(pks: string[]): number {
        const toRemove = pks.map(x => this.page.indexOf(x))
            .sort((x, y) => y - x)
            .filter(x => x >= 0)
        for (let key of toRemove) {
            this.page.splice(key, 1);
        }
        return toRemove.length;
    }

    update(items: IResource[]): void {
        console.log('updating ... ', items)
    }
    set sort(sort: Array<string>) {
        const key = getSortKey(sort);
        if (this.sortKey !== key) {
            this._sort = sort
            this.sortKey = key
            this.sortFunc = makeSortFunction(sort);
            this.reSort();
        }
    }
    get sort(): Array<string> {
        return this._sort
    }
}