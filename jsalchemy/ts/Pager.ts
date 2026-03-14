import Collection, {getFilterKey, getSortKey} from "./Collection";
import {FilterFunction, IQueryResult, IResource, SortFunction} from "./interfaces";
import {ResourceManager} from "./ResourceManager";
import {indexBy, IUnplaced, makeFilter, makeSortFunction, sleep, sortedInsert} from "./utils";

interface IMinMax {
    min: number
    max: number
}

class Unplaced {
    item: IResource
    before: number
    after: number
    constructor(item: IResource) {
        this.item = item
    }
}

export class Pager {
    pages: Map<number, Array<string>>
    invalids: Set<number> = new Set()
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
    minMaxItems: Map<number, IMinMax>
    rpp: number

    unplacedItems: Unplaced[]

    constructor(collection: Collection, filter: Record<string, string[]>, sort: string[]) {
        this.pages = new Map()
        this.invalids = new Set()
        this.collection = collection
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
        this.minMaxItems = new Map()
        this.rpp = this.collection.cls.rpp;
    }
    resolvePages(min: number, max: number): [number, number] {
        if (this.newBasket.length + this.removeBasket.length + this.updateBasket.length)
            this.processBaskets()
        else
            this.placeUnplaced()
        const minPage = Math.floor(min / this.collection.cls.rpp);
        const maxPage = Math.floor(max / this.collection.cls.rpp);
        return [minPage, maxPage]
    }
    placeItems(items: IResource[]) {
        const getPk = this.collection.cls.getPk;
        items.sort(this.sortFunc)
        const nextItem = ()=> {
            if (items.length) {
                const item = items.shift();
                return [item, new Unplaced(item)]
            }
            return [null, null]
        }
        let exploredPages = 0;
        for (let [nPage, page] of this.pages.entries()) {
            exploredPages ++
            let decoded = page.map(x => this.collection.pkIndex.get(x));
            let i = 0;
            let inserted = 0
            let item: IResource
            let place: Unplaced;
            [item, place] = nextItem()
            if (!item) break
            console.log(decoded.map(x => x ? this.sortFunc(x, item): null))
            const max = Math.min(decoded.length, this.rpp)
            for (; i < page.length; i++) {
                let pageItem = this.collection.pkIndex.get(page[i]);
                if (!pageItem)
                    continue
                let cmp = this.sortFunc(pageItem, item);
                if (cmp < 1) {
                    place.after = i;
                } else {
                    place.before = i;
                    if (place.after === (i - 1)) {
                        page.splice(i, 0, getPk(item))
                        inserted ++
                    } else if ((place.after === undefined) && (place.before === 0)) {
                        if (nPage === 0) {
                            page.unshift(getPk(item))
                            inserted++
                        }
                    } else if ((place.after === undefined) && (place.before === this.rpp)) {
                        page.push(getPk(item));
                        inserted ++
                    } else {
                        if (place.before)
                            place.before += (nPage * this.rpp)
                        if (place.after)
                            place.after += (nPage * this.rpp)
                        this.unplacedItems.push(place)
                    }
                    [item, place] = nextItem()
                    if (!item) break
                }
            }
            if (!place) break
            // if it's the last page
            if (Math.floor(this.totalCount / this.rpp) === nPage) {
                page.push(getPk(item));
                inserted++
                if (items.length) {
                    page.push(...items.map(x => getPk(x)))
                    break
                }
            }
            if ((place.after !== undefined) && !place.before && (i == max)) {
                if (Math.floor(this.totalCount / this.rpp) === nPage) {
                }
            } else if ((nPage === 0) && (page.length === 0)) {
                page.push(getPk(item));
            } else {
                this.unplacedItems.push(place)
            }
        }
    }
    async placeUnplaced() {
        const getPk = this.collection.cls.getPk;
        this.unplacedItems.sort((x, y) => (x.after || 0) - (y.after || 0));
        let unplaced = this.unplacedItems.shift();
        const basket = [];
        while (unplaced) {
            let after = unplaced.after || 0;
            let nPage = Math.floor((after || 0) / this.rpp)
            if (this.invalids.has(nPage))
                this.pages.set(nPage,
                    await this.resMan.verb(this.collection.cls.name, 'query', this.filterFor(nPage), false, false));
            if (this.pages.has(nPage)) {
                let page = this.pages.get(nPage);
                let offset = nPage * this.rpp
                for (let i = unplaced.after % this.rpp; i < Math.max(page.length, unplaced.after - offset); i ++) {
                    let item = this.collection.pkIndex.get(page[i]);
                    if (!item) continue;
                    if (this.sortFunc(item, unplaced.item) < 1) {
                        unplaced.after = i + offset;
                    } else {
                        unplaced.before = i + offset;
                        if (unplaced.after === (unplaced.before - 1)) {
                            page.splice(unplaced.before, 0, getPk(unplaced.item));
                        } else {
                            basket.push(unplaced);
                        }
                        break;
                    }
                }
            } else {
                console.log('Discarding it on a page we don\'t have', item.item)
            }
            unplaced = this.unplacedItems.shift();
        }
        this.unplacedItems.push(...basket)
    }
    inPage(key: string): number {
        for (let [num, page] of this.pages.entries()) {
            if (page.includes(key))
                return num
        }
        return -1
    }
    processBaskets() {
        let missingKeys: string[] = []
        const getPk = this.collection.cls.getPk;
        while (this.removeBasket.length) {
            let key = this.removeBasket.shift();
            for (let [nPage, page] of this.pages.entries()) {
                let idx = page.indexOf(key);
                if (idx >= 0) {
                    page.splice(idx, 1);
                    if (page.length < this.rpp) {
                        this.invalids.add(nPage);
                    }
                }
            }
        }
        this.placeUnplaced();
        const newItems = this.collection.get(...this.newBasket)
        this.newBasket.splice(0, this.newBasket.length)
        if (newItems.length) {
            this.placeItems(newItems);
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
        const [minPage, maxPage] = this.resolvePages(min, max)
        for (let page of [minPage, maxPage]) {
            if (this.pages.has(page))
                continue
            this.pushPage(page, await this.resMan.verb(this.collection.cls.name, 'query', this.filterFor(maxPage)));
        }
        return this.get(min, max);
    }
    remove(pks: string[]): number {
        let removed = 0
        for (let pk of pks) {
            for (let page of this.pages.values()) {
                let idx = page.indexOf(pk)
                if (idx >= 0)  {
                    page.splice(idx, 1)
                    removed++
                }
            }
        }
        return removed
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
        const offset = this.unplacedItems.filter(unplaced => unplaced.after < min).length
        min -= offset
        max -= offset
        if (minPage === maxPage) {
            if (!this.pages.has(minPage)) {
                this.require(min, max);
                if (callBack)
                    waitForInterval(min, max);
                return null
            }
            return this.pages.get(minPage).slice(min % this.rpp, max % this.rpp)
        } else {
            if (![minPage, maxPage].every(x => this.pages.has(x))) {
                this.require(min, max);
                if (callBack) {
                    waitForInterval(min, max);
                }
                return null;
            }
            return [
                ...this.pages.get(minPage).slice(min % this.rpp, this.rpp),
                ...this.pages.get(maxPage).slice(0, max % this.rpp)
            ]
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
        this.collection.pagers.get(this.filterKey).totalCount = result.totalCount
        this.pages.set(nPage, result.pks)
        const idx = this.waitingPages.indexOf(nPage);
        if (idx > 0)
            this.waitingPages.splice(idx, 1);
    }
    get missingPages(): [number, Pager][] {
        const ret: [number, Pager][] = this.requiredPages.map(x => x);
        this.waitingPages.push(...ret.map(x => x[0]))
        this.requiredPages.length = 0;
        return ret
    }
    get totalCount() {
        return this.collection.pagers.get(this.filterKey).totalCount
    }
}
