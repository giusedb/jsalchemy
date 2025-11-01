import utils from './utils.js';
import Index from './collection/Index.js'


/**
 * Reduce the filter excluding what has been already filtered
 */
export default class Reducer {
    constructor(collection) {
        this.gotAll = false;
        this.asked = {}; // map of array
        this.vacuum = {}; // vacuum to resolve
        this.compositeAsked = [];
        this.collection = collection;
    }


    /**
     * Mark one or more value of a field as missing and returns if you need to wait
     * @param fieldName {String} - the name of the field
     * @param args {Array<*>} - the missing values
     * @returns {boolean} - shall you wait ?
     */
    need(fieldName, ...args) {
        if (this.gotAll) {
            return false;
        }
        if (!(fieldName in this.vacuum)) {
            this.vacuum[fieldName] = new Set();
        }
        const missing = new Set(args).difference(this.getIndexFor(fieldName));
        for (let arg of missing) {
            this.vacuum[fieldName].add(arg);
            this.touch.touch();
        }
        return Boolean(missing.size);
    }

    vacuumFilter() {
        const ret = this.filter(this.vacuum);
        this.vacuum = {};
        return ret;
    }

    cartesianProduct1(x, y) {
        const ret = [];
        if (Array.isArray(x)) {
            for (const a of x) {
                for (const b of y) {
                    ret.push([a, b]);
                }
            }
        } else {
            for (const a in x) {
                for (const b in y) {
                    ret.push([x[a], y[b]]);
                }
            }
        }
        return ret;
    }

    cartesianProduct(arr) {
        let isArray = false;
        let ret = arr[0];
        for (let x = 1; x < arr.length; ++x) {
            ret = this.cartesianProduct1(ret, arr[x], isArray);
            isArray = true;
        }
        return ret;
    }

    explodeFilter(filter) {
        const product = this.cartesianProduct(Object.values(filter));
        const keys = Object.keys(filter);

        return product.map(x => {
            const r = {};
            keys.forEach((a, n) => (r[a] = x[n]));
            return r;
        });
    }

    /**
     * Compare the filter with the already requested data and returns the difference
     * @param filter {Object}
     * @return {Object | null}
     */
    filterSingle(filter) {
        if (this.gotAll) {
            return null;
        }
        if ((typeof filter === 'object') && Object.keys(filter).length === 0) {
            this.gotAll = true;
            return filter
        }
        const fieldName = Object.keys(filter)[0];
        const index = this.getIndexFor(fieldName)
        const needed = new Set(filter[fieldName]);
        let notRequested = needed.difference(index);
        const collectionIndex = this.collection.indexes[fieldName];
        if (collectionIndex && (collectionIndex.constructor === Index)) {
          for (let key of notRequested) {
            if (key in collectionIndex.idx) {
              notRequested.delete(key);
            }
          }
        }
        if (notRequested.size > 0) {
            const ret = Object.fromEntries([[fieldName, [...notRequested]]])
            notRequested.forEach((x) => index.add(x))
            return ret
        }
        return null;
    }

    cleanComposites(filter) {
        if (Object.keys(filter).length === 0) {
            this.compositeAsked = [];
        } else {
            const keys = Object.keys(filter);

            for (const x of keys) {
                delete filter[x];
            }

            // if (!this.compositeAsked.length || !Object.values(filter).some(
            //     value => this.compositeAsked.includes(value))) {
            //         delete this.compositeAsked;
            // }
        }
    }

    /**
     * Gets or create the index Set
     * @param fieldName - the field name which the index refers to
     * @type String
     * @returns Set
     */
    getIndexFor(fieldName) {
        if (!(fieldName in this.asked)) {
            this.asked[fieldName] = new Set();
        }
        return this.asked[fieldName];
    }

    /**
     * Make a filter reduction by avoiding requesting already requested data
     * @param model - the model name
     * @type model - String
     * @param filter - the filter
     * @type Object
     * @returns {{}|*|null}
     */
    filter(filter) {
        if ([null, undefined].includes(filter)) { filter = {}}
        const filterLen = Object.keys(filter).length;
        switch (filterLen) {
            case 0 : {
                if (this.gotAll) {
                    return null
                } else {
                    this.gotAll = true;
                    return {}
                }
            }
            case 1 : {
                let ret = this.filterSingle(filter);
                this.cleanComposites(filter);
                return ret;
            }
        }
        console.log('Multifilter ' + Object.keys(filter).join(', '));
        for (let f of this.compositeAsked) {
            if (utils.equalObject(f, filter)) {
                return null;
            } else {
                this.compositeAsked.push(filter);
                return filter
            }
        }

    }
}

export class FilterCacher {
    constructor(resourceManager) {
        this.models = {};
        this.resMan = resourceManager
    }

    /**
     * Gets or create the ListCahcer associated to the model
     * @param model {String} the model name
     * @return {Reducer}
     */
    getModelCacher(model) {
        if (!(model in this.models)) {
            this.models[model] = new Reducer(this.resMan.getCollection(model));
        }
        return this.models[model];
    }

    /**
     * Reduce the filter in order to bring less data
     * @param filter {Object}
     * @return {Object}
     */
    reduce(model, filter) {
        if ([null, undefined].includes(filter)) {
            return null;
        }
        for (let key in filter) {
            if (!Array.isArray(filter[key])) {
                filter[key] = [filter[key]];
            }
        }
        return this.getModelCacher(model).filterSingle(filter);
    }

    get(field) {
        let [modelName, fieldName] = field.split('.');
        return this.getModelCacher(modelName).getIndexFor(fieldName)
    }
}
