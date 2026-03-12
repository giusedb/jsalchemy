import {FilterFunction, SortFunction} from "./interfaces";

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
