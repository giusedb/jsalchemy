import { _ } from 'lodash';
import { FilterCacher } from "./reducer.js"
import makeModelClass from './classgen.js'
import { JSAlchemyConnection} from "./connection.js";
import Collection from "./collection/Collection.js";
import Toucher from "./toucher.js";
import { Logger } from "./logger.js";
import { autoLinker } from "./autolinker.js";
import storage from "./storage.js";

export class PermissionTable {

  constructor(id, klass, permissions) {
    this.klass = klass;
    this.permissions = [];
    this.id = id;
    for (var k in permissions) {
      this.push.apply(this, [k, permissions[k]]);
    }
  }

  save(callBack) {

  }

  push(groupId, permissionList) {

  }
}

export class ResourceManager {
  constructor(orm, options) {
    this.orm = orm
    this.touch = new Toucher()
    this.events = orm.$events;
    this.connection = new JSAlchemyConnection(this, options.endpoint, options.autoLogin);
    this.emit = this.events.emit.bind(this.events);

    // mode-based objects
    this.collections = {};
    this.modelCache = {};
    this.failedModels = new Set();
    this.unlinked = {};
    this.waitingConnections = {};
    this.descriptionWaiting = {};

    // event handlers
    this.on = this.events.on.bind(this.events);
    this.builderHandlers = {};
    this.builderHandlerUsed = {};
    this.persistentAttributes = {};
    this.eventHandlers = {};
    this.permissionWaiting = {};
    this.gotAll = new Set();

    this.filterCacher = new FilterCacher(this);

    this.log = new Logger('resource manager');
    autoLinker(this);
  }

  async get(modelName, ids) {
    let returnSingle = ids.constructor !== Array;
    if (returnSingle) {
      ids = [ids];
    }
    // if some entity is missing
    const result = await this.query(modelName, {id: ids});
    if (returnSingle) {
      return result[0]
    }
    return result
  }

  async delete(modelName, ids) {
  }

  getIndex(indexName) {
    if (!(indexName in this.IDB)) {
      this.IDB[indexName] = new Lazy({});
    }
    return this.IDB[indexName];
  }

  async list(modelName, filter, together) {
    // fetching asynchromous model from server
    filter = this.filterCacher.reduce(modelName, filter);

    if (this.connection.status.wsConnection) {
      // if somthing is missing on my local DB
      if (filter) {
        // ask for missings and parse server response in order to enrich my local DB.
        // placing lock for this model
        const data = await this.connection.fetch(modelName, 'list', {filter: filter})
        await this.gotData(data);
        return data;
      } else {
        return
      }
    } else {
      const data = await this.connection.fetch(modelName, 'list', filter)
      await this.gotData(data);
      if (!filter) {
        this.gotAll.add(modelName);
      }
      return data
    }

  }

  async verb(modelName, verb, kwargs, ignoreResults) {
    // fetching asynchromous model from server
    await this.describe(modelName);
    const data = await this.connection.fetch(modelName, verb, kwargs)
    if (!ignoreResults)
      await this.gotData(data);
    return data;
  }

  /**
   * Query the local DB feed the missing data with a server Query if needed.
   * Example:
   *  query('person', {firstName: ['mario', 'luigi'], lastName: 'bros'}, ['firstName desc'])
   *  this will query for all `person` with `firstName` "mario" or "luigi" and `lastName` = "bros"
   *  sort by `firstName` in descending order
   * @param modelName {String} - the model name to query
   * @param filter {Object} - the filter to apply
   * @param sort {Array<String>} - the list of filtering attributes
   * @returns {Promise<any[]>}
   */
  async query(modelName, filter, sort) {
    // ensure the model exists
    const model = await this.describe(modelName);
    // reduce the filter for the server
    const reducedFilter = this.filterCacher.reduce(modelName, filter)
    if (reducedFilter !== null) {
      await this.verb(modelName, 'get', {filter: reducedFilter})
    }
    // collect data from the Internal DB
    return this.collections[modelName].find(filter)
    // return this.IDB[modelName].values().filter(resourceFilter).sort(utils.sortFunction(sort)).toArray()
  }

  async gotData(data) {
    // receive all data from every end point
    if (typeof (data) === 'string') {
      console.log('data ' + data + ' refused from gotData()');
      return data;
    }

    if (data.description) {
      Object.values(data.description).forEach(this.gotModel.bind(this));
    }
    if (data.delete) {
        _(data.delete).entries().each(([resourceName, rawData]) => {
          const deleted = this.getCollection(resourceName).delete(...rawData);
          this.emit('deleted-' + resourceName,  deleted);
        });
    }
    if (data.new) {
      _(data.new).entries().each(([resourceName, rawData]) => {
        const reItems = this.collections[resourceName].bulkInsert(rawData);
        const updateItems = reItems.pop();
        const newItems = reItems.pop();

        //// sending signal for updated values
        if (updateItems.length) {
          this.emit('updated-' + resourceName, updateItems);
        }

        // sending events for new values
        if (newItems.length) this.emit('new-' + resourceName, newItems);
        // sending events for data arrived
        this.emit('received-' + resourceName);
        console.log('done');
      });
    }
    if (data.update) {
      _(data.update).entries().each(([resourceName, rawData]) => {
        if (!(resourceName in this.collections)) { return }
        const updateItems = this.collections[resourceName].bulkUpdate(rawData);
        if (updateItems.length) {
          this.emit('updated-' + resourceName, updateItems);
        }
        this.emit('received-' + resourceName);
      });
    }
    if (data.m2m) {
      for (let [resourceName, attrs] of Object.entries(data.m2m)) {
        let model = await this.describe(resourceName);
        for (let [attrName, attr] of Object.entries(attrs)) {
          let collection = this.getCollection(resourceName);
          if (!collection.m2m[attrName]) {
            collection.m2m[attrName] = {};
          }
          let mIndex = collection.getIndex(
            attrName, false, model.references[attrName].resource);
          _(['add', 'del']).each(verb => {
            _(attr[verb] || []).sortBy(0)
              .groupBy(0)
              .entries()
              .map(([k, v]) => [k, _(v).map(1).value()])
              .each(mIndex[verb].bind(mIndex));
          })
        }
      }
    }
    this.emit('got-data', data);
    return data;
  }

  gotModel(definition) {
    const modelName = definition.name;
    // localStorage['description:' + modelName] = JSON.stringify(definition);
    this.modelCache[modelName] = makeModelClass(this.orm, this, definition);
    if (!(modelName in this.collections)) {
      this.collections[modelName] = new Collection(this.touch, this.modelCache[modelName])
    }
    this.emit('got-model', this.modelCache[modelName]);
    this.emit('got-model-' + _.kebabCase(modelName), this.modelCache[modelName]);
  }

  gotPermissions(data) {
  }

  gotM2M(data) {
  }

  describe(modelName) {
    if (modelName in this.descriptionWaiting) {
      return this.descriptionWaiting[modelName];
    }
    const call = async () => {
      if (!(modelName in this.modelCache)) {
        if (this.failedModels.has(modelName)) {
          throw new Error(`model ${modelName} not found`);
        }
        const cacheKey = 'description:' + modelName;
        if (cacheKey in localStorage) {
          this.gotModel(JSON.parse(localStorage[cacheKey]));
        } else {
          try {
            this.gotData(await this.connection.fetch(modelName, 'describe'));
          } catch (e) {
            console.error(e);
            this.failedModels.add(modelName);
            return null;
          }
        }
        return this.modelCache[modelName];
      }
      return this.modelCache[modelName];
    }
    return this.descriptionWaiting[modelName] = call();
  }

  addModelHandler(modelName, decorator) {
    this.on('got-model-' + _.kebabCase(modelName), (model) => {
      decorator(model.prototype);
    });
  }

  addPersistentAttribute(modelName, attribute) {
    const key = `${modelName}.${attribute}:`;
    this.addModelHandler(modelName, (proto) => {
      Object.defineProperty(proto, attribute, {
        get() {
          return storage.get(key + this.$pk);
        },
        set(value) {
          storage.set(key + this.$pk, value);
        }
      });
    });
  }

  getCollection(modelName) {
    if (!(modelName in this.collections)) {
      this.describe(modelName).then(cls => {
        this.collections[modelName].cls = cls;
      });
      this.collections[modelName] = new Collection(this.touch);
    }
    return this.collections[modelName];
  }
}
