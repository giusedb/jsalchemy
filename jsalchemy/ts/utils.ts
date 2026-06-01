import {FilterFunction, IResource, SortFunction} from "./interfaces";
import _ from "lodash";
import Storage from "./storage";

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
        return `[${vals.map(JSON.stringify).join(" ")}]`;
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
export function range(_from: number = 1, to: number = 0) {
    if (to === 1) {
        to = _from
        _from = 1;
    }
    return Array.from({length: to - _from}, (_, i) => _from + i)
}
export async function xdr(url: string, data: any, application: string, token: string, formEncode: boolean = false): Promise<any> {
    return new Promise(function(accept, reject) {
        let req;
        if (!data) {
            data = {};
        }
        
        if (XMLHttpRequest) {
            req = new XMLHttpRequest();
            req.onreadystatechange = () => {
                if (req.readyState === 4) {
                    let responseData = null;
                    try{
                        responseData = JSON.parse(req.responseText);
                    } catch (a){
                        responseData = null;
                    }
                    let response = {
                        responseData: responseData,
                        responseText: req.responseText,
                        status: req.status,
                        request: req
                    };
                    if ((req.status >= 200) && (req.status < 400)) {
                        accept(response);
                    } else {
                        reject(response);
                    }
                }
            };
        } else if(XDomainRequest){
            req = new XDomainRequest();
            req.onload = function() {
                accept(req.responseText,req.statusText, req);
            };
        } else {
            reject(new Error('CORS not supported'));
        }
        
        req.onerror = reject;
        req.open('POST', url, true);
        req.setRequestHeader('Accept','application/json');
        if (token) { data.__token__ = token }
        if (!formEncode){
            req.setRequestHeader('Content-Type','application/json');
            data = JSON.stringify(data);
        } else {
            req.setRequestHeader('Content-Type','application/x-www-form-urlencoded');
            data = Object.keys(data).map(k => k + '=' + encodeURI(data[k].toString())).join('&');
        }
        try {
          req.send(data);
        } catch (error) {
          reject(error);
        }
    });
}
export function kebabCase(str: string): string {
  let ret = str.replace(/[A-Z]([a-z]|[0-9])+/g, (x) => `-${x.toLowerCase()}`);
  return (ret.startsWith('-') ? ret.substring(1) : ret).toLowerCase();
}
function equal(a: any, b: any): boolean {
  if (a === b)
    return true;
  if ((a === null) !== (b === null))
    return false;
  if ((a === undefined) !== (b === undefined))
    return false;
  if (a.constructor !== b.constructor)
    return false;
  if (a.constructor === Object)
    return equalDict(a, b);
  if (a.constructor === Array)
    return arrayEqual(a, b);
  if (a.constructor === Set)
    return a.symmetricDifference(b).size === 0;
  return false;
}
export function equalDict(source: Record<string, any>, target: Record<string, any>, keys?: Set<string>): boolean {
  if (source === target)
    return true;
  let [sKeys, tKeys] = [source, target].map(Object.keys);
  let cKeys = new Set(sKeys).intersection(new Set(tKeys));
  let diffKeys = new Set(sKeys).symmetricDifference(new Set(tKeys));
  if (keys) {
    cKeys = new Set(keys).intersection(cKeys);
    diffKeys = diffKeys.intersection(new Set(keys));
  }
  if (diffKeys.size)
    return false;
  for (let key of cKeys) {
    let sVal = source[key], tVal = target[key];
    if (!equal(sVal, tVal))
      return false;
  }
  return true;
}
export function diffDict(A: Record<string, any>, B: Record<string, any>, keys?: Set<string>): Record<string, [any, any]> | null {
  const ret: [string, any, any][] = [];
  let [a, b] = [A, B].map(Object.keys);
  let cKeys = new Set(a).intersection(new Set(b));
  let aOnly = new Set(a).difference(new Set(b));
  let bOnly = new Set(b).difference(new Set(a));
  if (keys) {
    cKeys = new Set(keys).intersection(cKeys);
    aOnly = aOnly.intersection(new Set(keys));
    bOnly = bOnly.intersection(new Set(keys));
  }
  for (let k of aOnly)
    ret.push([k, A[k], null]);
  for (let k of bOnly)
    ret.push([k, null, B[k]]);
  for (let k of cKeys)
    if (!equal(A[k], B[k]))
      ret.push([k, A[k], B[k]]);
  if (ret.length)
    return Object.fromEntries(ret.map(row => [row[0], [row[1], row[2]]]));
  return null;
}
export function equalObject(a: Record<string, any>, b: Record<string, any>): boolean {
  return equalDict(a, b);
}
export function deepMap(obj: any, func: (val: any, path?: string) => any, path?: string): any {
  if (!obj) {
    return obj;
  }
  let result: any = null;
  if (['array', 'object'].includes(typeof obj)) {
    let add: ((val: any, path: string) => void) | null = null;
    let fullPath: string | null = null;
    if (obj.constructor === Array) {
      result = [];
      add = function (val: any, path: string) {
        result.push(val);
      };
    } else {
      result = {};
      add = function (val: any, path: string) {
        result[path] = val;
      };
    }
    for (let key in obj) {
      if (path) {
        fullPath = obj.constructor === Array ? `${path}[${key}]` : `${path}.${key}`;
      } else {
        fullPath = key;
      }
      let val = obj[key];
      if (val && ((val.constructor === Array) || (val.constructor === Object))) {
        add(deepMap(func(val, fullPath), func, fullPath), key);
      } else {
        add(func(val, fullPath), key);
      }
    }
  } else {
    return obj;
  }
  return result;
}
export function cleanDescription(): void {
    for (let key of Storage.keys()) {
        if (key.startsWith('description:')) {
            Storage.del(key)
        }
    }
}
export function indexMap(list: any[], indexer: Function ): Map<any, any> {
    const ret = new Map();
    for (let item of list) {
        ret.set(indexer(item), item)
    }
    return ret;
}

export default {
    groupBy, indexBy, sleep, makeFilter, makeSortFunction, arrayEqual, range,
    xdr, kebabCase, cleanDescription, indexMap,
    equalDict, diffDict, equalObject, deepMap
}
