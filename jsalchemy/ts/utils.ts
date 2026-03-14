import {FilterFunction, IResource, SortFunction} from "./interfaces";

export interface IUnplaced {
    item: IResource,
    before: number,
    after: number
}

export function groupBy(array: object[], key: string | Function): Record<string, object[]> {
    const ret = {};
    if (typeof key === 'string') {
        array.forEach(item => {
            if (!(key in ret)) {
                ret[key] = [];
            }
            ret[key].push(item)
        });
    } else if (typeof key === 'function') {
        array.forEach(item => {
            const k = key(item)
            if (!(k in ret)) {
                ret[k] = [];
            }
            ret[k].push(item)
        });
    }
    return ret;
}
export function indexBy(array: object[], key: string | Function): Record<string, object> {
    let ret = {};
    if (key.constructor === String)
        array.forEach(item => { ret[item[key]] = item });
    if (key.constructor === Function)
        array.forEach(item => ret[key(item)] = item);
    return ret;
}
export function sleep(ms: number): Promise<null> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export function makeFilter(filter: Record<string, string[]>, unifier: string = '&&', dontTranslateFilter: boolean): FilterFunction {
    if (Object.keys(filter).length === 0) {
      return (x) => { return true};
    }
    let source = Object.entries(filter)
      .map(([key, vals]) => {
        if (!Array.isArray(vals)) {
          vals = [vals];
        }
        if (vals.length === 1) {
          return `x.${key} === ${JSON.stringify(vals[0])}`
        }
        return `[${vals.map(JSON.stringify).join(", ")}].includes(x.${key})`
      })
      .join(` ${unifier} `);
    return <FilterFunction>new Function("x", "    if (!x) return false;\n    return " + source);
}
export function makeSortFunction(sort: string | string[]): SortFunction {
    let sortArray: string[];
    if (typeof sort === 'string') {
      sortArray = sort.split(',')
    } else if (Array.isArray(sort)) {
      sortArray = sort
    }
    const content = sortArray.map(item => {
      item = item.trim();
      if (item.startsWith('~')) {
        return {
          field: item.substring(1),
          order: 'desc',
        }
      } else {
        return {
          field: item,
          order: 'asc'
        }
      }
    }).map(item => {
        let ret = ' 1: -1';
        if (item.order === 'asc') {
           ret = '-1: 1';
        }
        return `
        if (a.${item.field} !== b.${item.field}) {
            if (a.${item.field} === null) { return 1; }
            if (b.${item.field} === null) { return -1; }
            return a.${item.field} < b.${item.field} ? ${ret};
        }`
    }).join('');
    return <SortFunction>new Function(['a', 'b'], content + '\nreturn 0;');

}
export function arrayEqual(a1: string[], a2: string[]): boolean {
    if (a1.length !== a2.length)
        return false
    for (let i = 0; i < a1.length; i ++) {
        if (a1[i] !== a2[i])
            return false;
    }
    return true
}
export function range(_from: number = 0, to: number = 0) {
    if (to === 0) {
        to = _from
        _from = 0;
    }
    return Array.from({length: to - _from}, (_, i) => _from + i)
}
