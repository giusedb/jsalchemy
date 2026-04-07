import Collection, {getFilterKey, getSortKey} from "./Collection";
import {FilterFunction, IPager, IQueryFilter, IQueryResult, IResource, SortFunction} from "./interfaces";
import {ResourceManager} from "./ResourceManager";
import {indexBy, IUnplaced, makeFilter, makeSortFunction, sleep, sortedInsert} from "./utils";
import {SimplePager} from "./SimplePager";

interface IMinMax {
    min: number
    max: number
}

export class Unplaced {
    item: IResource
    before: number
    after: number
    constructor(item: IResource) {
        this.item = item
    }
}

export class Pager implements IPager{
    pages: Map<number, Array<string>>
    invalids: Set<number> = new Set()
    collection: Collection
    resMan: ResourceManager
    filter: Record<string, string[]>
    filterKey: string
    filterFunc: FilterFunction
    _sort: string[]
    sortKey: string
    sortFunc: SortFunction
    newBasket: string[]
    removeBasket: string[]
    updateBasket: IResource[]
    requiredPages: [number, Pager][];
    waitingPages: number[];
    minMaxItems: Map<number, IMinMax>
    rpp: number;
    _isComplete: boolean;
    page: Array<string>;
    sorted: Array<string>;

    unplacedItems: Unplaced[]

    constructor(collection: Collection, filter: Record<string, string[]>, sort: string[]) {
        this.pages = new Map()
        this.invalids = new Set()
        this.collection = collection
        this.resMan = collection.resMan
        this.filter = filter;
        this._sort = sort;
        this.filterKey = getFilterKey(this.filter);
        this.filterFunc = makeFilter(filter);
        this.sortKey = getSortKey(sort);
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
    resolvePages(min: number, max: number): [number, number, number] {
        if (this.newBasket.length + this.removeBasket.length + this.updateBasket.length)
            this.processBaskets()
        else
            this.placeUnplaced()
        const offset = this.unplacedItems.filter(unplaced => unplaced.after < min).length
        const minPage = Math.floor(min / this.rpp);
        const maxPage = Math.floor(max / this.rpp);
        return [minPage, maxPage, offset]
    }
    /*
     * Place the Unplaced items in the pager.
     * each Unplaced item in the `unplacedItems` array has a `item` property that is the item to be placed
     * and an `after` property that is the index of the item and the page after which the item should be placed.
     * the `Unplaced.before` property is the index of the item and the page before which the item should be placed.
     *
     * Insert the items in the pager in the correct position according to `this.sortFunc` function.
     * If an item has no precise position add the `Unplaced` to the im
     */
    placeUnplaced() {
        const getPk = this.collection.cls.getPk;
        const field = this.sort[0].replace('~', '');

        const unplaceds: Unplaced[] = [];
        this.unplacedItems.sort((x, y) => this.sortFunc(x.item, y.item))
        let lastValid = 0;
        let lastVisited = 0;
        let pageNumbers = [...this.pages.keys()];
        let lastPage = Math.min(...pageNumbers);
        let unplaced = this.unplacedItems.shift();
        let j = 0
        let inserted = 0
        let page: string[]
        let found: boolean
        let offset: number
        let cmp: number

        if (unplaced && (lastPage === 0) && (this.pages.get(0).length === 0)) {
            this.pages.get(0).push(getPk(unplaced.item));
            inserted ++
            unplaced = this.unplacedItems.shift();
        }

        while (unplaced) {
            console.log(`pick item ${unplaced.item[field]}`)
            if (this.pages.values().some(page => page.includes(getPk(unplaced.item)))) {
                console.log('Item already in pager')
                unplaced = this.unplacedItems.shift();
                continue
            }
            if (unplaced.after) {
                unplaced.after -= inserted;
                lastPage = Math.floor(unplaced.after / this.rpp);
                j = lastPage * unplaced.after % this.rpp
            } else {
                j = lastVisited;
            }
            page = this.pages.get(lastPage);
            offset = this.rpp * lastPage;
            found = false;
            while (!found) {
                let counterItem = this.collection.pkIndex.get(page[j]);
                if (counterItem) {
                    lastValid = lastVisited
                    cmp = this.sortFunc(counterItem, unplaced.item);
                    console.log(unplaced.item[field], cmp == 1 ? '<' : '>', counterItem[field])
                    if (cmp < 0) {
                        unplaced.after = j + offset
                    } else {
                        found = true
                        unplaced.before = j + offset;
                    }
                } else {
                    console.log(`Undefined. Skip ${page[j]}.`)
                }
                if (found) {
                    if (unplaced.before === (unplaced.after + 1)) {
                        page.splice(unplaced.before, 0, getPk(unplaced.item));
                        inserted++;
                    } else if (unplaced.before === 0) {
                        page.unshift(getPk(unplaced.item));
                        inserted++;
                    } else {
                        unplaceds.push(unplaced)
                    }
                } else {
                    if (j >= this.rpp) {
                        console.log('Reached the rpp')
                    }
                    if (j < (page.length - 1))
                        j++;
                    else {
                        let idxPage = pageNumbers.indexOf(lastPage);
                        if (pageNumbers.length > (idxPage + 1)){
                            console.log('check next page')
                            lastPage = pageNumbers[idxPage + 1];
                            page = this.pages.get(lastPage);
                            offset = this.rpp * lastPage;
                            j = 0;
                        } else {
                            console.log('Its last page. I add it')
                            page.push(getPk(unplaced.item));
                            inserted++;
                            found = true;
                            break;
                        }
                    }
                }
            }
            unplaced = this.unplacedItems.shift();
        }
        this.unplacedItems.push(...unplaceds);
        console.log('Clean up pages')
        for (let [numPage, page] of this.pages.entries()) {
            let size = this.rpp - this.unplacedItems.filter(
                u => [u.before, u.after].every(
                    x => x >= (numPage * this.rpp) && x < ((numPage + 1) * this.rpp))
            ).length;
            if ((page.length > size) && (this.pages.has(numPage + 1))) {
                this.pages.get(numPage + 1).unshift(...page.splice(size));
            }
            if ((page.length < size) && (this.pages.has(numPage + 1))) {
                page.push(...this.pages.get(numPage + 1).splice(0, size - page.length));
            }
        }
    }
    processBaskets() {
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
    }
    filterFor(nPage: number): IQueryFilter {
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
        const [minPage, maxPage, offset] = this.resolvePages(min, max)
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
    /*
     * Add items to the pager's unplacedItems basket
     * @param items
     */
    add(items: IResource[]) {
        // maybe sorted insert would be better
        this.unplacedItems.push(...items.map(x => new Unplaced(x)))
    }
    update(items: IResource[]) {
        this.updateBasket.push(...items)
    }
    /**
     * Checks weather a defined interval (by `min` -> `max`)is loaded
     * @param min
     * @param max
     */
    hasInterval(min: number, max: number): boolean {
        return this.resolvePages(min, max).slice(0, 2).every(x => this.pages.has(x));
    }
    /**
     * Returns the primary keys array from `min` to `max` according to the `sort` order
     * @param min
     * @param max
     */
    get(min: number, max: number, callBack: Function = null): string[] {
        if (this.checkCompleteness()) {
            return this.unify().get(min, max);
        }
        const waitForInterval = async (min: number, max: number) => {
            let retry = 100;
            while (retry && !this.hasInterval(min, max)) {
                await sleep(50);
                retry --;
            }
            if (retry)
                callBack(this.get(min, max));
        }
        const [minPage, maxPage, offset] = this.resolvePages(min, max)
        min -= offset;
        max -= offset;
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
        for (let page of pages.slice(0, 2)) {
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
    unify() {
        console.log(`Unifying ${this.filterKey} pager`)
        const iSort = this.collection.pagers.get(this.filterKey);
        iSort.isComplete = true;
        for (let key of [...iSort.pagers.keys()])
            iSort.pagers.delete(key);
        const page = [];
        this.pages.values().forEach(array => page.push(...array));
        const newPager = new SimplePager(this.collection, this.filter, this.sort, page)
        iSort.pagers.set('', newPager);
        this.resMan.emit('pager-unified', this.filterKey, newPager);
        return newPager
    }
    checkCompleteness() {
        if (!this.pages.size)
            return false
        if (this.pages.size < Math.floor((this.totalCount / this.rpp) + 1))
            return false
        if (this.pages.values().map(x => x.length).reduce((x, y) => x + y) != this.totalCount)
            return false
        return this.pages.values()
            .every(page => page.every(pk => this.collection.pkIndex.has(pk)))

    }
    private reSort() {
        const pkIdx = this.collection.pkIndex
        const srt = (x, y) => this.sortFunc(pkIdx.get(x), pkIdx.get(y))
        this.sorted = this.page.sort(srt);
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
    get isComplete() {
        if (this._isComplete)
            return true;
        this._isComplete = this.collection.pagers.get(this.filterKey).isComplete
        return this._isComplete
    }
    // get sorted() {
    //     const pkIdx = this.collection.pkIndex
    //     const srt = (x, y) => this.sortFunc(pkIdx.get(x), pkIdx.get(y))
    //     return this.page.sort(srt);
    // }
    set sort(sort: Array<string>) {
        const key = getSortKey(sort);
        if (this.sortKey !== key) {
            this._sort = sort
            this.sortKey = key
            this.sortFunc = makeSortFunction(sort);
            if (this.isComplete) {
                this.reSort();
            }
        }
    }
    get sort(): Array<string> {
        return this._sort
    }
}
