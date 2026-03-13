import Collection, {getFilterKey, getSortKey} from "./Collection";
import {FilterFunction, IQueryResult, IResource, SortFunction} from "./interfaces";
import {ResourceManager} from "./ResourceManager";
import {indexBy, makeFilter, makeSortFunction, sleep} from "./utils";

interface Unplaced {
    item: IResource;
    key: string;
    gt: number;
    lt?: number;
}

export class Pager {
    pages: Map<number, Array<string>>
    invalids: Set<number> = new Set()
    totalCount: number
    collection: Collection
    resMan: ResourceManager
    filter: Record<string, string[]>
    filterKey: string
    filterFunc: FilterFunction
    sort: string[]
    sortKey: string
    sortFunc: SortFunction
    newBasket: string[]
    removeBasket: string[]
    updateBasket: IResource[]
    requiredPages: [number, Pager][];
    waitingPages: number[];

    unplacedItems: Unplaced[]

    constructor(collection: Collection, filter: Record<string, string[]>, sort: string[]) {
        this.pages = new Map()
        this.invalids = new Set()
        this.collection = collection
        this.totalCount = null
        this.resMan = collection.resMan
        this.filter = filter;
        this.sort = sort;
        this.filterKey = getFilterKey(this.filter);
        this.filterFunc = makeFilter(filter);
        this.sortKey = getSortKey(this.sort);
        this.sortFunc = makeSortFunction(sort);
        this.newBasket = []
        this.updateBasket = []
        this.removeBasket = []
        this.unplacedItems = [];
        this.requiredPages = [];
        this.waitingPages = [];
    }
    resolvePages(min: number, max: number): [number, number] {
        const minPage = Math.floor(min / this.collection.cls.rpp);
        const maxPage = Math.floor(max / this.collection.cls.rpp);
        return [minPage, maxPage]
    }
    placeItem(item: IResource) {
        for (let [n, page] of this.pages.entries()) {
            let ll = page.length;
            let i = 0;
            while (i < ll) {
                if (-1 === this.sortFunc(item, this.collection.pkIndex.get(page[i]))) {
                    this.pages[n] = [
                        ...this.pages[n].slice(0, i),
                        this.collection.cls.getPk(item),
                        ...this.pages[n].slice(i)
                    ]
                    break
                }
                i ++;
            }
            if ((i === ll) && (n === Math.max(...this.pages.keys()))) {
                page.push(this.collection.cls.getPk(item));
            }
        }
    }
    inPage(key: string): number {
        for (let [num, page] of this.pages.entries()) {
            if (page.includes(key))
                return num
        }
        return -1
    }
    async processBaskets() {
        let missingKeys: string[] = []
        const getPk = this.collection.cls.getPk;
        const newItems = this.collection.get(...this.newBasket)
        if (newItems.length) {
            this.newBasket.length = 0;
            newItems.forEach(this.placeItem.bind(this));
        }
        for (let pk of this.removeBasket) {
            for (let [n, page] of this.pages.entries()) {
                let idx = page.indexOf(pk);
                if (idx > 0) {
                    page.splice(idx, 1)
                }
            }
        }
    }

    filterFor(nPage: number) {
        return {
            filter: this.filter,
            paging: {
                rpp: this.collection.cls.rpp,
                page: nPage,
                sort: this.sort
            }
        }
    }

    async fetch(min: number, max: number): Promise<string[]> {
        if (this.newBasket.length + this.removeBasket.length + this.updateBasket.length)
            await this.processBaskets()
        const [minPage, maxPage] = this.resolvePages(min, max)
        for (let page of [minPage, maxPage]) {
            if (this.pages.has(page))
                continue
            this.pushPage(page, await this.resMan.verb(this.collection.cls.name, 'query', this.filterFor(maxPage)));
        }
        return this.get(min, max);
    }
    remove(pks: string[]) {
        this.removeBasket.push(...pks)
    }
    add(pks: string[]) {
        this.newBasket.push(...pks);
    }
    update(items: IResource[]) {
        this.updateBasket.push(...items)
    }
    /**
     * Checks weather a defined interval (by `min` -> `max`)is loaded
     * @param min
     * @param max
     */
    hasInterval(min: number, max: number): Boolean {
        return this.resolvePages(min, max).every(x => this.pages.has(x));
    }
    /**
     * Returns the primary keys array from `min` to `max` according to the `sort` order
     * @param min
     * @param max
     */
    get(min: number, max: number, callBack: Function = null): string[] {
        const waitForInterval = async (min: number, max: number) => {
            while (!this.hasInterval(min, max)) {
                await sleep(50)
            }
            callBack(this.get(min, max));
        }
        const [minPage, maxPage] = this.resolvePages(min, max)
        if (minPage === maxPage) {
            if (!this.pages.has(minPage)) {
                this.require(min, max);
                if (callBack)
                    waitForInterval(min, max);
                return null
            }
            return this.pages.get(minPage).slice(
                min % this.collection.cls.rpp,
                max % this.collection.cls.rpp
            )
        } else {
            if (![minPage, maxPage].every(x => this.pages.has(x))) {
                this.require(min, max);
                if (callBack) {
                    waitForInterval(min, max);
                }
                return null;
            }
            return [...this.pages.get(minPage).slice(
                min % this.collection.cls.rpp,
                this.collection.cls.rpp
            ), ...this.pages.get(maxPage).slice(
                0,
                max % this.collection.cls.rpp
            )]
        }

    }
    require(min: number, max: number) {
        let pages = this.resolvePages(min, max);
        for (let page of pages) {
            if (!this.requiredPages.map(x => x[0]).includes(page) && !this.waitingPages.includes(page)) {
                this.requiredPages.push([page, this])
                this.collection.touch.touch();
            }
        }
    }
    pushPage(nPage: number, result: IQueryResult) {
        this.pages.set(nPage, result.pks)
        const idx = this.waitingPages.indexOf(nPage);
        if (idx > 0)
            this.waitingPages.splice(idx, 1);
        this.collection.pagers.get(this.filterKey).totalCount = result.totalCount
    }
    get missingPages(): [number, Pager][] {
        const ret: [number, Pager][] = this.requiredPages.map(x => x);
        this.waitingPages.push(...ret.map(x => x[0]))
        this.requiredPages.length = 0;
        return ret
    }

}
