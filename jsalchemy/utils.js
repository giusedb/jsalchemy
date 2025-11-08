import 'lodash';

const mocks = {};

class MockObject {

    constructor(model, id) {
        if (!(model in mocks)) {
            mocks[model] = {}
        }
        const mockModel = mocks[model];
        if (!(id in mockModel)) {
            mockModel[id] = {};
        }
        mockModel[id] = this;
    }

    get(target, name) {
        console.log(`name: ${name}, target: ${target}`);
    }
}

function upgradeMock(model, id, data) {
    if (!(model.modelName in mocks)) {
        return
    }
    if (!(id in mocks[model.modelName])) {
        return
    }
    const obj = mocks[model.modelName][id];
    obj.constructor = model;
    obj.constructor(data);
}

function Interval(seconds) {
  this.totalSeconds = seconds;
}

Object.defineProperty(Interval.prototype, 'days' , { get() {
  return Math.floor(this.totalSeconds / 86400);
}})

Object.defineProperty(Interval.prototype, 'hours' , { get() {
  return Math.floor((this.totalSeconds % 86400) / 3600);
}});

Object.defineProperty(Interval.prototype, 'minutes' , { get() {
    return Math.floor((this.totalSeconds % 3600) / 60);
}});

Object.defineProperty(Interval.prototype, 'seconds' , { get() {
  return Math.floor(this.totalSeconds % 60);
}});

export default {
    renameFunction : function (name, fn) {
        return (new Function("return function (call) { return function " + name +
            " () { return call(this, arguments) }; };")())(Function.apply.bind(fn));
    },
    cached : function(func, key){
        if (!key){
            key = '_' + cachedKeyIdx++;
        }
        function wrapper(){
            if (!this[key]){
                this[key] = func.call(this,[arguments]);
            }
            return this[key];
        };
        return wrapper;
    },
    log: function(){
        console.log(arguments);
    },
    xdr: (url, data, application,token, formEncode) => {
        /**
         * Make an HTTP Request and return its promise.
         */
        return new Promise(function(accept, reject) {
            let req;
            if (!data) {
                data = {};
            }

            if(XMLHttpRequest) {
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

            req.open('POST', url, true);
            req.onerror = reject;
            req.setRequestHeader('Accept','application/json');
            if (token) { data.__token__ = token }
            if (!formEncode){
                req.setRequestHeader('Content-Type','application/json');
                data = _(data).size()?JSON.stringify(data):'';
            } else {
                req.setRequestHeader('Content-Type','application/x-www-form-urlencoded');
                data = _(data).map(function(v,k){
                  return k + '=' + encodeURI(v.toString());
                }).toArray().join('&');
            }
            try {
              req.send(data);
            } catch (error) {
              reject(error);
            }
        })
    },
    capitalize : function (s) {
        return s[0].toUpperCase() + s.slice(1).toLowerCase();
    },
    hash : function(str){
        /**
         * Hashed function
         */
        str = str.toString();
        var ret = 1;
        for (var x = 0;x<str.length;x++){
            ret *= (1 + str.charCodeAt(x));
        }
        return (ret % 34958374957).toString();
    },
    makeFilter : function (filter, unifier, dontTranslateFilter) {
        /**
         * Make filter for Array.filter function as an and of or
         */
        if (!unifier) { unifier = ' && ';}
        if (_(filter).size() == 0) {
          return (x) => { return true};
        }
        let source = _(filter)
          .entries()
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
        return new Function("x", "    if (!x) return false;\n    return " + source);
    },
    sameAs : function (x, y) {
        /**
         * Deep equal
         */
        for (var k in x) {
            if (y[k] != x[k]) {
                return false;
            }
        }
        return true;
    },
    pluralize : function(str, model){
        /**
         * Lexically returns english plural form
         */
        return str + 's';
    },
    beforeCall : function(func, before){
        var decorator = function(){
            before().then(func)
        };
        return decorator;
    },
    cleanStorage : function(){
        /**
         * Clean localStorage object
         */
        _(localStorage).keys().each(function(k){
            delete localStorage[k];
        })
    },
    cleanDescription: function() {
        _(localStorage)
            .filter(function(v, n) { return _(n).startsWith('description:')})
            .keys()
            .each(function(n) { delete localStorage[n] });
    },
    reverse : function (chr, str) {
        return str.split(chr).reverse().join(chr);
    },
    permutations: function(arr){
        var ret = [];
        for (var x = arr.length-1; x >= 0;x--){
            for (var y = arr.length-1; y >= 0; y--){
                if (x !== y)
                    ret.push([arr[x], arr[y]]);
            }
        }
        return ret;
    },
    waitFor: function(func, callBack) {
        var waiter = function() {
            if (func()) {
                callBack();
            } else {
                setTimeout(waiter,500);
            }
        }
        setTimeout(waiter, 500);
    },
    bool: Boolean,
    noop : function(){},
    tzOffset: new Date().getTimezoneOffset() * 60000,
    transFieldType: {
        date: function(x) { return new Date(x * 1000 + utils.tzOffset ) },
        datetime: function(x) { return new Date(x * 1000 + utils.tzOffset ) },
        string: function(x) { return x.toString(); },
        text: function(x) { return x.toString(); },
        integer: function(x) { return parseInt(x); },
        float: function(x) { return parseFloat(x); }
    },
    equal(A, B) {
      if (A === B)
        return true;
      if ((A === null) ^ (B === null))
        return false;
      if ((A === undefined) ^ (B === undefined))
        return false;
      if (A.constructor !== B.constructor)
        return false;
      if (A.constructor === Object)
        return this.equalDict(A, B);
      if (A.constructor === Array)
        return this.equalArray(A, B);
      if (A.constructor === Set)
        return A.symmetricDifference(B).size === 0;
    },
    equalDict(source, target, keys) {
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
        if (!this.equal(sVal, tVal))
          return false;
      }
      return true
    },
    equalArray(A, B) {
      if (A === B)
        return true;
      const al = A.length
      if (al != B.length)
        return false
      for (let i = 0; i < al; i ++) {
        if (!this.equal(A[i], B[i]))
          return false
      }
      return true;
    },
    diffDict(A, B, keys) {
      const ret = [];
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
        if (!this.equal(A[k], B[k]))
          ret.push([k, A[k], B[k]]);
      if (ret.length)
        return Object.fromEntries(ret.map(row => [row[0], [row[1],row[2]]]));
      return null;
    },
    mock(model, id) {
        return new MockObject(model, id);

    },
    sortFunction(sort) {
        if (!Array.isArray(sort)) {
            sort = [sort];
        }
        const content = sort.map(item => {
            if (/ /.test(item)) {
                item = item.split(/\s+/)
            } else {
                item = [item, 'asc']
            }
            return {
                field: item[0],
                order: item[1],
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
        return new Function(['a', 'b'], content + '\nreturn 0;');
    },
    upgradeMock: upgradeMock,
    kebabCase(str) {
      let ret = str.replace(/[A-Z]([a-z]|[0-9])+/g, (x) => `-${x.toLowerCase()}`);
      return (ret.startsWith('-') ? ret.substring(1) : ret).toLowerCase();
    },
    deepMap(obj, func, path) {
      if (!obj) {
        return obj;
      }
      let result = null;
      if (['array', 'object'].includes(typeof obj)) {
        let add = null;
        let fullPath = null;
        if (obj.constructor === Array) {
          result = [];
          add = function (val, path) {
            result.push(val);
          };
        } else {
          result = {};
          add = function (val, path) {
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
            add(this.deepMap(func(val, fullPath), func, fullPath), key);
          } else {
            add(func(val, fullPath), key);
          }
        }
      } else {
        return obj;
      }
      return result;
    }
};
