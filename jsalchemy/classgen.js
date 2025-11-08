import 'lodash';
import { Logger } from "./logger.js";
import utils from './utils.js'

const log = new Logger('Class')

/**
 * Create a cached property and invalidate it's cache by accessing an event
 * @param proto
 * @param propertyName
 * @param getter
 * @param setter
 */
function cachedPropertyByEvents(proto, propertyName, getter, setter){
    const events = Array.prototype.slice.call(arguments,4);
    let result = {};

    events.forEach(function(event){
        proto.constructor.resMan.on(event, () => {
            result = {};
        });
    });
    const propertyDef = {
        get: function cached(){
//            return getter.call(this);
            if (!(this.id in result)){
                result[this.id] = getter.call(this);
            }
            return result[this.id];
        }
    };
    if (setter){
        propertyDef['set'] = value => {
            if (!isFinite(value)) {
                if (this.id in result) {
                    delete result[this.id];
                }
            } else {
//            if (value !== result[this.id]){
                setter.call(this, value);
                if (this.id in result){
                    delete result[this.id];
                }
//            }
            }
        }
    }
    Object.defineProperty(proto, propertyName, propertyDef);
}

const JS_TYPES = {
    'biginteger': 'Number',
    'integer': 'Number',
    'float': 'Number',
    'boolean': 'Boolean',
    'interval': 'Interval',
    'string': 'String',
    'text': 'String',
    'char': 'String',
    'decimal': 'Number',
    'json': 'Object',
    'array': 'Array',
}

const TYPE_CONVERSIONS = {
  Date: (name) => `row.${name} ? new Date(row.${name} * 1000) : null `,
  DateTime: (name) => `row.${name} ? new Date(row.${name} * 1000) : null `,
}
const TYPE_BACK_CONVERTERS = {
  Date: (value) => value ? value.getTime() / 1000 : null,
  DateTime: (value) => value ? value.getTime() / 1000 : null,
}

/**
 * Create the class from the class definition
 * @param orm {Orm} - the ORM instance this klass is attached to
 * @param resMan {ResourceManager} - the ResourceManager instance this class is attached to
 * @param model {Object} - the Object as per server sent
 * @returns {*}
 */
export default function makeModelClass(orm, resMan, model) {
  console.log(model);

  const noop = (val) => val;

  let getPk = null;
  if (model.$pk.length === 1) {
    const pk = model.$pk[0];
    getPk = function() {
      return this[pk];
    }
  } else {
    const code = _(model.$pk).map(x => `this.${x}`).join(',').value()
    getPk = new Function(`return [${code}].join("-");`);
  }

  const typeConverters = Object.fromEntries(
    _(model.fields)
      .map(field => [field.name, TYPE_BACK_CONVERTERS[field.type] || noop])
    );

  const writableFields = new Set(_(model.fields).filter(f => !f.readonly).map('name'));
  model.$pk.forEach(x => writableFields.add(x));

  const funcFields = ' if ("$row" in this) {\n' + [true, false].map(update =>
    model.fields.map(field => {
      let assignment = null;
      if (!(field.type in TYPE_CONVERSIONS)) {
         assignment = `      this.${field.name} = row.${field.name};`;
      } else {
        assignment = `      this.${field.name} = ${TYPE_CONVERSIONS[field.type](field.name)};`;
      }
      if (update) {
        return `    if ("${field.name}" in row) {\n${assignment}\n    }`
      } else {
        return assignment;
      }
    }).join('\n')
  ).join('\n} else {\n') + '\n    }';

  // Final build the basic constructor
  let funcString = funcFields;
  funcString += '\nthis.$row = this.$pk ? (this.$row ? this.$raw : row) : {};';
  const init = new Function('row', 'permissions', funcString + '\nreturn this;');
  const Klass = new Function(`return function ${model.name} (row, permission) {\n    return this.$init(row, permission);\n}`)();
  Klass.prototype.$init = new Function('row', 'permissions', funcString + '\n    return this;');
  model.references
    // .filter(ref => ref.type === 'm2m')
    .forEach(ref => {
      let multi = ref.type === 'many';
      if (ref.type === 'm2m') {
        // Property
        Object.defineProperty(Klass.prototype, ref.attribute, {
          get() {
            const rIds = resMan.getCollection(Klass.name)
              .getIndex(ref.attribute, false, ref.resource)
              .get(this[ref.local_attribute]);
            const rIndex = orm.resources.getCollection(ref.resource)
                .getIndex(ref.foreign_attribute);
            return _(Array.from(rIds)).filter(Boolean)
              .map(rIndex.get.bind(rIndex))
              .filter(Boolean)
              .value();
          }
        });
        // detachAttribute
        Klass.prototype[_.camelCase('detach ' + ref.attribute)] = async function(...items) {
          console.info('Dissociating ' + ref.attribute);
          const keys = _(items)
            .filter(Boolean)
            .map(item => [this[ref.local_attribute], item.constructor === Number ? item : item[ref.foreign_attribute]])
            .value();
          if (keys.length) {
            await resMan.verb(model.name, 'm2m', { attribute: ref.attribute, keys, method: 'delete' });
            return true;
          }
          return false
        }
        // attachAttribute
        Klass.prototype[_.camelCase('attach ' + ref.attribute)] = async function(...items) {
          console.info('Associating ' + ref.attribute);
          const keys = _(items)
            .filter(Boolean)
            .map(item => [this[ref.local_attribute], item.constructor === Number ? item : item[ref.foreign_attribute]])
            .value();
          if (keys.length) {
            await resMan.verb(model.name, 'm2m', {attribute: ref.attribute, keys, method: 'add'});
            return true
          }
          return false;
        }
        // setAttribute
        Klass.prototype[_.camelCase('set ' + ref.attribute)] = async function(...items) {
          console.info('Setting ' + ref.attribute);
          const keys = _(items)
            .filter(Boolean)
            .map(item => [this[ref.local_attribute], item.constructor === Number ? item : item[ref.foreign_attribute]])
            .value();
          if (keys.length) {
            await resMan.verb(model.name, 'm2m', {attribute: ref.attribute, keys, method: 'set'});
            return true
          }
          return false;
        }
        // getAttribute
        Klass.prototype[_.camelCase('get ' + ref.attribute)] = async function() {
          const m2mIdx = Klass.prototype.$collection.indexes[ref.attribute]
          if (!m2mIdx || !m2mIdx.requested.has(this[ref.local_attribute])) {
            const links = await resMan.verb(model.name, 'm2m',
              {attribute: ref.attribute, keys: [this[ref.local_attribute]], method: 'get'});
            return await orm.get(ref.resource, _(links.MANYTOMANY[model.name][ref.attribute].add).map(1).uniq().value())
          }
          return this[ref.attribute];
        }
      } else {
        Object.defineProperty(Klass.prototype, ref.attribute, {
          get() {
            return resMan.getCollection(ref.resource)
              .getIndex(ref.foreign_attribute, multi)
              .get(this[ref.local_attribute]);
          }
        });
        Klass.prototype[_.camelCase('get ' + ref.attribute)] = async function() {
          const key = this[ref.local_attribute];
          if (!(resMan.collections[ref.resource] &&
            resMan.collections[ref.resource].indexes[ref.foreign_attribute] &&
            resMan.collections[ref.resource].indexes[ref.foreign_attribute].requested.has(key))) {
            let filter = {[ref.foreign_attribute]: [key]};
            await resMan.query(ref.resource, filter);
          }
          return this[ref.attribute];
        }
      }
    });
  if (model.verbs) {
    model.verbs.forEach(verb => {
      const defaults = Object.assign({}, verb.defaults);
      Klass.prototype[_.camelCase(verb.name)] = async function(...args) {
        const kwargs = Object.fromEntries(
          _.zip(verb.args, args)
            .map(([k, v]) => [k, v === undefined ? defaults[k] : v]));
        kwargs['pk'] = this.$pk;
        const ret = await resMan.verb(model.name, verb.name, kwargs, verb.detatchReturn);
        const toResolve = {};
        if (ret.payload?.$ref) {
          return  await resMan.get(...ret.payload.$ref);
        }
        utils.deepMap(ret.payload, (x) => {
          if ((typeof x === 'object') && (x.constructor === Object) && ('$ref' in x)) {
            if (!(x.$ref[0] in toResolve)) {
              toResolve[x.$ref[0]] = new Set();
            }
            toResolve[x.$ref[0]].add(x.$ref[1]);
          }
          return x;
        });
        const resolved = {};
        for (let [resource, pks] of Object.entries(toResolve)) {
          const res = await resMan.get(resource, Array.from(pks));
          if (!(resource in resolved)) {
            resolved[resource] = {};
          }
          resolved[resource] = Object.fromEntries(res.map(x => [x.$pk, x]));
        }
        ret.payload = utils.deepMap(ret.payload, (x) => {
          if (x && (typeof x === 'object') && (x.constructor === Object) && ('$ref' in x)) {
            return resolved[x.$ref[0]][x.$ref[1]];
          }
          return x;
        });
        return ret.payload;
      }
    });
  }
  Object.defineProperty(Klass.prototype, '$collection', {
    get() {
      return resMan.getCollection(model.name);
    }
  })

  // Add references
  Object.assign(Klass, {
    references: Object.fromEntries(model.references.map(f => [f.attribute, f])),
    fields: Object.fromEntries(model.fields.map(f => [f.name, f])),
    orm: orm,
    $pk: model.$pk,
  });

  Object.defineProperty(Klass.prototype, '$raw', {get() {
    return Object.fromEntries(_(this.constructor.fields)
      .keys()
      .map(field => [field, typeConverters[field](this[field])]));
  }});

  Object.defineProperty(Klass.prototype, '$pk', {get: getPk});

  Object.defineProperty(Klass.prototype, '$dirty',
    {get() {
      return !utils.equalDict(this.$row, this.$raw, writableFields);
  }});

  Object.defineProperty(Klass, '$attributeTypes', {
    get() {
      const toReplace = {};
      const references = {};
      _(this.references)
        .values()
        .filter(x => ['one', 'm2m'].includes(x.type))
        .each(x => {
          if (x.type === 'one') {
            toReplace[x.local_attribute] = x.attribute;
          }
          references[x.attribute] = x;
        });
      const ret = Object.fromEntries(
        _(this.fields).map(x => [
          toReplace[x.name] || x.name,
          references[x.name] || { attribute: x.name, type: x.type }]));
      _(references).entries().each(([key, ref]) => {
        ret[key] = ref;
      })
      return _(ret).values().value();
    }
  });

  Klass.prototype.$clone = function() {
    return new Klass(this.$raw);
  }
  Klass.prototype.$save = async function() {
    const diff = utils.diffDict(this.$row, this.$raw, writableFields);
    if (!diff)
      return this;
    const modified = Object.fromEntries(
      _(diff).entries()
        .map(([k, v]) => [k, v[1]]));
    model.$pk.forEach(k => modified[k] = this[k]);
    const res = await orm.resources.verb(model.name,
      this.$pk ? 'put' : 'post', modified);
    if (res.$validation) {
      res.$validation = res.$validation;
      return this;
    }
    // this.$init(res[model.name][0]);
    const collection = resMan.getCollection(model.name);
    collection.update(this);
    const ret = collection.get(this.$pk);
    resMan.emit('got-data', ret);
    return this;
  }
  Klass.prototype.$delete = async function() {
    const res = await orm.resources.verb(model.name, 'delete', {pks: [this[model.$pk[0]]]});
    console.log(`deleting ${model.name} ${res}`);
    return res;
  }

  if (model.format_string) {
    Klass.prototype.toString = new Function('return `' + model.format_string + '`;');
  }

  return Klass;
};
