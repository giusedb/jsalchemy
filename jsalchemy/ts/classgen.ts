import _ from 'lodash';
import utils from './utils';
import RSet from "./RSet";
import {IResourceDef, IResourceClass, IReference, IVerb, IField, IResource} from "./interfaces";
import {ResourceManager} from "./ResourceManager";
import Orm from "./Orm";

/* ------------------------------------------------------------------ */
/*  Field-type conversion maps                                         */
/* ------------------------------------------------------------------ */

const JS_TYPES: Record<string, string> = {
  biginteger: 'Number',
  integer: 'Number',
  float: 'Number',
  boolean: 'Boolean',
  interval: 'Interval',
  string: 'String',
  text: 'String',
  char: 'String',
  decimal: 'Number',
  json: 'Object',
  array: 'Array',
};

const TYPE_CONVERSIONS: Record<string, (name: string) => string> = {
  Date: (name: string) => `row.${name} ? new Date(row.${name} * 1000) : null `,
  DateTime: (name: string) => `row.${name} ? new Date(row.${name} * 1000) : null `,
};

const TYPE_BACK_CONVERTERS: Record<string, (value: any) => number | null> = {
  Date: (value: any) => (value ? value.getTime() / 1000 : null),
  DateTime: (value: any) => (value ? value.getTime() / 1000 : null),
};

type ReactiveFn = (val: any) => { value: any };

/* ------------------------------------------------------------------ */
/*  Main entry point — generate a resource class                       */
/* ------------------------------------------------------------------ */

export function makeResourceClass(
  orm: Orm,
  resMan: ResourceManager,
  model: IResourceDef,
  reactive?: ReactiveFn,
): IResourceClass {
  const noop = (val: any) => val;

  /* -- primary-key getter -- */
  let getPk: (this: IResource) => string;
  if (model.$pk.length === 1) {
    const pk = model.$pk[0];
    getPk = new Function('', `return this.${pk};`) as unknown as () => string;
  } else {
    const code = _(model.$pk)
      .map((x: string) => `this.${x}`)
      .join(',')
      .value();
    getPk = new Function(`return [${code}].join("-");`) as unknown as () => string;
  }

  /* -- field conversion table -- */
  const typeConverters: Record<string, (val: any) => any> = Object.fromEntries(
    _(model.fields)
      .map((field: IField) => [field.name, TYPE_BACK_CONVERTERS[field.type] || noop]),
  );

  /* -- writable-fields set -- */
  const writableFields = new Set(
    _(model.fields)
      .filter((f: IField) => !f.readonly)
      .map('name'),
  );
  model.$pk.forEach((x: string) => writableFields.add(x));

  /* -- constructor body (dynamic code-gen) -- */
  const funcFields =
    ' if ("$row" in this) {\n' +
    [true, false]
      .map((update) =>
        model.fields
          .map((field: IField) => {
            let assignment: string;
            if (!(field.type in TYPE_CONVERSIONS)) {
              assignment = `      this.${field.name} = row.${field.name};`;
            } else {
              assignment = `      this.${field.name} = ${TYPE_CONVERSIONS[field.type](field.name)};`;
            }
            if (update) {
              return `    if ("${field.name}" in row) {\n${assignment}\n    }`;
            }
            return assignment;
          })
          .join('\n'),
      )
      .join('\n} else {\n') +
    '\n    }';

  let funcString = funcFields;
  funcString += '\nthis.$row = this.$pk ? (this.$row ? this.$raw : row) : {};';
  funcString += '\nthis.$rs = {}';
  funcString += '\nreturn this;';

  // These `new Function()` calls are inherently un-typeable.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const initBody = new Function('row', 'permissions', funcString) as unknown as (
    row: any,
    permissions?: any,
  ) => IResource;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const Klass = new Function(
    `return function ${model.name}(row, permission) {\n    return this.$init(row, permission);\n}`,
  )() as IResourceClass & {
    new (...args: any[]): IResource;
    prototype: Record<string, any>;
    rpp: number;
    getPk: (obj: any) => string;
    getFilterKey: (obj: any) => Record<string, any>;
    get: (...pks: string[]) => Promise<IResource[]>;
    isComplete: (item: any) => boolean;
    references: Record<string, IReference>;
    fields: Record<string, IField>;
    orm: Orm;
    $pk: string[];
    $attributeTypes: any[];
  };

  Klass.prototype.$init = initBody;

  /* -- references (relations) -- */
  model.references.forEach((ref: IReference) => {
    if (ref.type === 'm2m') {
      /* m2m property */
      Object.defineProperty(Klass.prototype, ref.attribute, {
        get(this: IResource) {
          const rIds = resMan
            .getCollection(Klass.name)
            .getIndex(ref.attribute, false, ref.resource)
            .get(this[ref.local_attribute]);
          const rIndex = orm.resources.getCollection(ref.resource).getIndex(ref.foreign_attribute);
          return _(Array.from(rIds))
            .filter(Boolean)
            .map(rIndex.get.bind(rIndex))
            .filter(Boolean)
            .value();
        },
      });

      /* detach */
      Klass.prototype[_.camelCase('detach ' + ref.attribute)] = async function (
        this: IResource,
        ...items: any[]
      ) {
        console.info('Dissociating ' + ref.attribute);
        const keys = _(items)
          .filter(Boolean)
          .map((item: any) => [
            this[ref.local_attribute],
            item.constructor === Number ? item : item[ref.foreign_attribute],
          ])
          .value();
        if (keys.length) {
          await resMan.verb(model.name, 'm2m', {
            attribute: ref.attribute,
            keys,
            method: 'delete',
          });
          return true;
        }
        return false;
      };

      /* attach */
      Klass.prototype[_.camelCase('attach ' + ref.attribute)] = async function (
        this: IResource,
        ...items: any[]
      ) {
        console.info('Associating ' + ref.attribute);
        const keys = _(items)
          .filter(Boolean)
          .map((item: any) => [
            this[ref.local_attribute],
            item.constructor === Number ? item : item[ref.foreign_attribute],
          ])
          .value();
        if (keys.length) {
          await resMan.verb(model.name, 'm2m', {
            attribute: ref.attribute,
            keys,
            method: 'add',
          });
          return true;
        }
        return false;
      };

      /* set */
      Klass.prototype[_.camelCase('set ' + ref.attribute)] = async function (
        this: IResource,
        ...items: any[]
      ) {
        console.info('Setting ' + ref.attribute);
        const keys = _(items)
          .filter(Boolean)
          .map((item: any) => [
            this[ref.local_attribute],
            item.constructor === Number ? item : item[ref.foreign_attribute],
          ])
          .value();
        if (keys.length) {
          await resMan.verb(model.name, 'm2m', {
            attribute: ref.attribute,
            keys,
            method: 'set',
          });
          return true;
        }
        return false;
      };

      /* get */
      Klass.prototype[_.camelCase('get ' + ref.attribute)] = async function (this: IResource) {
        const m2mIdx = Klass.prototype.$collection.indexes[ref.attribute];
        if (!m2mIdx || !m2mIdx.requested.has(this[ref.local_attribute])) {
          const links = await resMan.verb(model.name, 'm2m', {
            attribute: ref.attribute,
            keys: [this[ref.local_attribute]],
            method: 'get',
          });
          return await orm.get(
            ref.resource,
            _(links.MANYTOMANY[model.name][ref.attribute].add)
              .map(1)
              .uniq()
              .value(),
          );
        }
        return this[ref.attribute];
      };
    } else if (ref.type === 'one') {
      /* to-one property */
      Object.defineProperty(Klass.prototype, ref.attribute, {
        get(this: IResource) {
          const collection = resMan.getCollection(ref.resource);
          const ret = collection.pkIndex.get(this[ref.local_attribute]);
          if (ret) return ret;
          const cacheKey = `__cache_${ref.attribute}`;
          if (cacheKey in this) return this[cacheKey];
          // Vue reactive if available
          const state = reactive ? reactive(null) : { value: null };
          this[cacheKey] = state;
          (async () => {
            state.value = await resMan.get(ref.resource, this[ref.local_attribute]);
          })();
          return state;
        },
      });

      /* getOne */
      Klass.prototype[_.camelCase('get ' + ref.attribute)] = async function (this: IResource) {
        const key = this[ref.local_attribute];
        if (
          !(
            resMan.collections[ref.resource] &&
            resMan.collections[ref.resource].indexes[ref.foreign_attribute] &&
            resMan.collections[ref.resource].indexes[ref.foreign_attribute].requested.has(key)
          )
        ) {
          const filter: Record<string, string[]> = {};
          filter[ref.foreign_attribute] = [key];
          await resMan.query(ref.resource, filter);
        }
        return this[ref.attribute];
      };
    } else {
      /* to-many property */
      Object.defineProperty(Klass.prototype, ref.attribute, {
        get(this: IResource) {
          // reactive may be undefined — fallback to plain object
          const state: { value?: any } = reactive ? reactive({}) : {};
          if (!(ref.attribute in this.$rs)) {
            const filter: Record<string, any> = {};
            filter[ref.foreign_attribute] = this[ref.local_attribute];
            this.$rs[ref.attribute] = new RSet(resMan, ref.resource, filter);
          }
          return this.$rs[ref.attribute];
        },
      });
    }
  });

  /* -- custom verbs -- */
  if (model.verbs) {
    model.verbs.forEach((verb: IVerb) => {
      const defaults = Object.assign({}, verb.defaults);
      const target = verb.isInstance ? Klass.prototype : Klass;

      target[_.camelCase(verb.name)] = async function (this: any, ...args: any[]) {
        const kwargs: Record<string, any> = Object.fromEntries(
          _.zip(verb.args, args).map(([k, v]: [string, any]) => [
            k,
            v === undefined ? defaults[k] : v,
          ]),
        );
        if (verb.isInstance) {
          kwargs.pk = this.$pk;
        }
        let ret = await resMan.verb(model.name, verb.name, kwargs, verb.detachReturn);

        // Resolve $ref references in the returned data
        if (ret?.$ref) {
          return await resMan.get(...ret.payload.$ref);
        }

        const toResolve: Record<string, Set<any>> = {};
        utils.deepMap(ret, (x: any) => {
          if (x && typeof x === 'object' && x.constructor === Object && '$ref' in x) {
            if (!(x.$ref[0] in toResolve)) {
              toResolve[x.$ref[0]] = new Set();
            }
            toResolve[x.$ref[0]].add(x.$ref[1]);
          }
          return x;
        });

        const resolved: Record<string, Record<string, IResource>> = {};
        for (const [resource, pks] of Object.entries(toResolve)) {
          const res = await resMan.get(resource, Array.from(pks));
          resolved[resource] = Object.fromEntries(res.map((x: IResource) => [x.$pk, x]));
        }

        ret = utils.deepMap(ret, (x: any) => {
          if (x && typeof x === 'object' && x.constructor === Object && '$ref' in x) {
            return resolved[x.$ref[0]]?.[x.$ref[1]];
          }
          return x;
        });
        return ret;
      };
    });
  }

  /* -- $collection -- */
  Object.defineProperty(Klass.prototype, '$collection', {
    get(this: IResource) {
      return resMan.getCollection(model.name);
    },
  });

  /* -- static members -- */
  Klass.rpp = model.rpp;

  if (model.$pk.length === 1) {
    Klass.getPk = new Function(
      'obj',
      `return obj.${model.$pk[0]}`,
    ) as unknown as (obj: any) => string;
  } else {
    const exp = model.$pk.map((x: string) => `obj.${x} || ''`).join(" + '-' + ");
    Klass.getPk = new Function('obj', `return '' + ${exp};`) as unknown as (obj: any) => string;
  }

  Klass.get = function (this: IResourceClass, ...pks: string[]) {
    return resMan.get(model.name, ...pks);
  };

  Klass.isComplete = function (item: any) {
    return (
      new Set(Object.keys(Klass.fields)).difference(new Set(Object.keys(item))).size === 0
    );
  };

  Object.assign(Klass, {
    references: Object.fromEntries(
      model.references.map((f: IReference) => [f.attribute, f]),
    ),
    fields: Object.fromEntries(model.fields.map((f: IField) => [f.name, f])),
    orm: orm,
    $pk: model.$pk,
  });

  /* -- prototype getters -- */
  Object.defineProperty(Klass.prototype, '$raw', {
    get(this: IResource) {
      return Object.fromEntries(
        _(this.constructor.fields)
          .keys()
          .map((field: string) => [field, typeConverters[field](this[field])]),
      );
    },
  });

  Object.defineProperty(Klass.prototype, '$pk', { get: getPk });

  Object.defineProperty(Klass.prototype, '$dirty', {
    get(this: IResource) {
      return !utils.equalDict(this.$row as any, this.$raw as any, writableFields);
    },
  });

  Object.defineProperty(Klass.prototype, '$diff', {
    get(this: IResource) {
      return utils.diffDict(this.$row as any, this.$raw as any, writableFields);
    },
  });

  Object.defineProperty(Klass, '$attributeTypes', {
    get(this: typeof Klass) {
      const toReplace: Record<string, string> = {};
      const references: Record<string, IReference> = {};
      _(this.references)
        .values()
        .filter((x: IReference) => ['one', 'm2m'].includes(x.type))
        .each((x: IReference) => {
          if (x.type === 'one') {
            toReplace[x.local_attribute] = x.attribute;
          }
          references[x.attribute] = x;
        });
      const ret: Record<string, any> = Object.fromEntries(
        _(this.fields).map((x: IField) => [
          toReplace[x.name] || x.name,
          references[x.name] || { attribute: x.name, type: x.type },
        ]),
      );
      _(references)
        .entries()
        .each(([key, ref]: [string, IReference]) => {
          ret[key] = ref;
        });
      return _(ret).values().value();
    },
  });

  /* -- instance methods -- */
  Klass.prototype.$clone = function (this: IResource) {
    return new Klass(this.$raw) as IResource;
  };

  Klass.prototype.$save = async function (this: IResource) {
    const diff = this.$diff;
    if (!diff) return this;

    const modified: Record<string, any> = Object.fromEntries(
      _(diff)
        .entries()
        .map(([k, v]: [string, [any, any]]) => [k, v[1]]),
    );
    model.$pk.forEach((k: string) => (modified[k] = this[k]));
    const isNew = !this.$pk;

    await orm.resources.verb(model.name, isNew ? 'post' : 'put', modified, false, true, {
      dontCreate: true,
      savedItems: [this],
    });

    const collection = resMan.getCollection(model.name);
    const ret = await collection.get(this.$pk);
    return ret && ret[0];
  };

  Klass.prototype.$delete = async function (this: IResource) {
    return await orm.resources.verb(model.name, 'delete', {
      pks: [this[model.$pk[0] as string]],
    });
  };

  Klass.getFilterKey = new Function(
    'obj',
    'return {' + model.$pk.map((k: string) => `${k}: obj.${k}`).join(', ') + '}',
  ) as unknown as (obj: any) => Record<string, any>;

  if (model.format_string) {
    Klass.prototype.toString = new Function(
      'return `' + model.format_string + '`;',
    ) as unknown as () => string;
  }

  return Klass;
}