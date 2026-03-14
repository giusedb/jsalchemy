// resources.ts
import _ from 'lodash';
import {JSAlchemyConnection} from "../connection";
import Collection from "./Collection";
import Toucher from "./Toucher";
import {FilterCacher} from "./Reducer";
import {Logger} from "../logger";
import {DataPayload, IGotDataOptions, IOrmOptions, IResource, IResourceClass, IResourceDef} from "./interfaces";
import { makeResourceClass } from "./classgen";
import {Autolinker} from "./Autolinker";
import {indexBy, sleep} from "./utils";

// Type definitions
type PermissionList = string[];
type ModelPermissions = Record<string, PermissionList>;
type Filter = Record<string, any>;

export class PermissionTable {
  klass: any;
  permissions: Array<{ groupId: string; permissionList: PermissionList }>;
  id: string;

  constructor(id: string, klass: any, permissions: ModelPermissions) {
    this.klass = klass;
    this.permissions = [];
    this.id = id;
    
    for (const k in permissions) {
      this.push(k, permissions[k]);
    }
  }

  save(callBack: Function): void {
    // Implementation would go here
  }

  push(groupId: string, permissionList: PermissionList): void {
    // Implementation would go here
  }
}

export class ResourceManager {
  orm: any;
  touch: Toucher;
  events: any;
  connection: JSAlchemyConnection;
  emit: Function;
  on: Function;
  collections: Record<string, Collection>;
  classCache: Record<string, IResourceClass>;
  failedModels: Set<string>;
  unlinked: Record<string, any>;
  waitingConnections: Record<string, any>;
  descriptionWaiting: Record<string, Promise<any>>;
  builderHandlers: Record<string, Function>;
  builderHandlerUsed: Record<string, boolean>;
  persistentAttributes: Record<string, any>;
  eventHandlers: Record<string, Function>;
  permissionWaiting: Record<string, any>;
  gotAll: Set<string>;
  filterCacher: FilterCacher;
  autoLinker: Autolinker;
  reactive: Function;

  constructor(orm: any, options: IOrmOptions) {
    this.orm = orm;
    this.touch = new Toucher();
    this.events = orm.$events;
    this.connection = new JSAlchemyConnection(this, options.endpoint, options.autoLogin);
    this.reactive = options.reactive;
    this.emit = this.events.emit.bind(this.events);

    // mode-based objects
    this.collections = {};
    this.classCache = {};
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
    this.autoLinker = new Autolinker(this);
    this.autoLinker.start(50);
  }

  async delete(modelName: string, pks: any): Promise<void> {
    await this.verb(modelName, 'delete', { pks });
  }

  async list(modelName: string, filter: Filter, together?: any): Promise<any[]> {
    // fetching asynchronous model from server
    const reducedFilter = this.filterCacher.reduce(modelName, filter);

    if (this.connection.status.wsConnection) {
      // if something is missing on my local DB
      if (reducedFilter) {
        // ask for missings and parse server response in order to enrich my local DB.
        // placing lock for this model
        const data = await this.connection.fetch(modelName, 'list', { filter: reducedFilter });
        await this.gotData(data);
        return data;
      } else {
        return [];
      }
    } else {
      const data = await this.connection.fetch(modelName, 'list', reducedFilter);
      await this.gotData(data);
      if (!filter) {
        this.gotAll.add(modelName);
      }
      return data;
    }
  }

  async verb(
    modelName: string, 
    verb: string, 
    kwargs: any, 
    ignoreResults?: boolean, 
    fullResult?: boolean,
    gotDataOptions?: any,
  ): Promise<any> {
    // fetching asynchronous model from server
    await this.describe(modelName);
    const data = await this.connection.fetch(modelName, verb, kwargs);
    const payload = data.payload;
    
    if (!ignoreResults) {
      await this.gotData(data, gotDataOptions);
    }
    
    if (fullResult) {
      if (payload) {
        data.payload = payload;
      }
      return data;
    }
    
    return payload;
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
  async query(modelName: string, filter: Filter): Promise<RSet> {
    // ensure the model exists
    // const model = await this.describe(modelName);
    return new RSet(this, modelName, filter);
  }
  async get(resourceName: string, pks: string[] | string): Promise<any> {
    const model = await this.describe(resourceName);
    let filter: Filter = {};
    let keys: string[];
    if (Array.isArray(pks)) {
        keys = pks
    } else {
        keys = [pks]
    }
    const collection = this.getCollection(resourceName);
    while (collection.missing.size > 0)
        await sleep(50);
    const missing = Array.from(
        new Set(keys)
            .difference(collection.requested)
            .difference(new Set(collection.pkIndex.keys())))
    if (missing.length > 0) {
      await this.verb(resourceName, 'get', { pks: missing });
    }
    
    const ret = collection.get(...keys);
    if (Array.isArray(pks))
      return ret
    return ret[0]
  }
  async gotData(data: DataPayload, options: IGotDataOptions = {}): Promise<DataPayload> {
    // receive all data from every end point
    if (typeof data === 'string') {
      console.log('data ' + data + ' refused from gotData()');
      return data;
    }

    if (data.description) {
      Object.values(data.description).forEach((definition: any) => {
        this.gotModel(definition);
      });
    }
    
    if (data.delete) {
      Object.entries(data.delete).forEach(([resourceName, rawData]: any) => {
        const collection = this.getCollection(resourceName);
        if (!collection) return;
        
        const idx = collection.pkIndex;
        const xx = rawData.filter(x => idx.has(x))
        const deleted = collection.delete(...xx);
        
        if (deleted.length) {
          this.emit('deleted-' + resourceName, deleted);
        }
        
        this.emit('deleted-' + resourceName + '-pk', new Set(rawData));
      });
    }
    
    if (data.update) {
      Object.entries(data.update).forEach(([resourceName, rawData]: any) => {
        if (!(resourceName in this.collections)) {
          return;
        }
        
        const collection = this.getCollection(resourceName);
        if (!collection) return;
        let getPk = collection.cls.getPk;
        let isComplete = collection.cls.isComplete;
        const updateItems: [IResource, object][] = [];
        for (let item of rawData) {
            if (isComplete(item)) {
                if (!data.new) {
                    data.new = {};
                }
                if (!(resourceName in data.new)) {
                    data.new[resourceName] = [];
                }
                data.new[resourceName].push(item);
                continue
            }
            let oldItem: IResource = collection.pkIndex.get(getPk(item))
            if (!oldItem) {
                console.warn(`Item in collection ${collection.cls.name} has no item with Pk ${getPk(item)}`)
                updateItems.push([null, item])
            } else {
                updateItems.push([oldItem, item])
            }
        }
        if (updateItems.length) {
          collection.bulkUpdate(updateItems);
          this.emit(`updated-${resourceName}`, updateItems);
        }
        this.emit(`received-${resourceName}`);
      });
    }

    [[data.new || [], true], [data.read || [], false]].forEach(([items, hydratePagers]) => {
      Object.entries(items).forEach(([resourceName, rawData]: any) => {
        const collection = this.getCollection(resourceName);
        if (!collection) return;

        const reItems = collection.bulkInsert(rawData, Boolean(hydratePagers), options);
        const updateItems = reItems.pop();
        const newItems = reItems.pop();

        //// sending signal for updated values
        if (updateItems.length) {
          this.emit('updated-' + resourceName, updateItems);
        }

        // sending events for new values
        if (newItems.length) {
          this.emit('new-' + resourceName, newItems);
        }

        // sending events for data arrived
        this.emit('received-' + resourceName);
        // console.log('done');
      });
    });

    if (data.m2m) {
      for (const [resourceName, attrs] of Object.entries(data.m2m)) {
        const model = await this.describe(resourceName);
        for (const [attrName, attr] of Object.entries(attrs)) {
          const collection = this.getCollection(resourceName);
          if (!collection) continue;
          
          if (!collection.m2m[attrName]) {
            collection.m2m[attrName] = {};
          }
          
          const mIndex = collection.getIndex(
            attrName, false, model.references[attrName].resource);
          
          ['add', 'del'].forEach((verb: string) => {
            const items = attr[verb] || [];
            _(items).sortBy(0)
              .groupBy(0)
              .entries()
              .map(([k, v]: any) => [k, _(v).map(1).value()])
              .forEach((item: any) => {
                mIndex[verb].bind(mIndex)(...item);
              });
          });
        }
      }
    }
    
    this.emit('got-data', data);
    return data;
  }
  gotModel(definition: any): void {
    const modelName = definition.name;
    // localStorage['description:' + modelName] = JSON.stringify(definition);
    let resourceClass: IResourceClass
    resourceClass = makeResourceClass(this.orm, this, definition);
    this.classCache[modelName] = resourceClass;
    
    if (!(modelName in this.collections)) {
      this.collections[modelName] = new Collection(this, this.touch, this.classCache[modelName]);
    }

    this.emit('got-model', this.classCache[modelName]);
    this.emit('got-model-' + _.kebabCase(modelName), this.classCache[modelName]);
  }
  gotPermissions(data: any): void {
    // Implementation would go here
  }
  gotM2M(data: any): void {
    // Implementation would go here
  }
  describe(modelName: string): Promise<any> {
    if (modelName in this.descriptionWaiting) {
      return this.descriptionWaiting[modelName];
    }
    
    const call = async (): Promise<any> => {
      if (!(modelName in this.classCache)) {
        if (this.failedModels.has(modelName)) {
          throw new Error(`model ${modelName} not found`);
        }
        
        const cacheKey = 'description:' + modelName;
        if (cacheKey in localStorage) {
          this.gotModel(JSON.parse(localStorage[cacheKey]));
        } else {
          try {
            const descriptionData = await this.connection.fetch(modelName, 'describe');
            this.gotData(descriptionData);
          } catch (e) {
            console.error(e);
            this.failedModels.add(modelName);
            return null;
          }
        }
        
        return this.classCache[modelName];
      }
      
      return this.classCache[modelName];
    };
    
    return this.descriptionWaiting[modelName] = call();
  }
  addModelHandler(modelName: string, decorator: Function): void {
    this.on('got-model-' + _.kebabCase(modelName), (model: any) => {
      decorator(model.prototype);
    });
  }
  addPersistentAttribute(modelName: string, attribute: string): void {
    const key = `${modelName}.${attribute}:`;
    this.addModelHandler(modelName, (proto: any) => {
      Object.defineProperty(proto, attribute, {
        get() {
          return storage.get(key + this.$pk);
        },
        set(value: any) {
          storage.set(key + this.$pk, value);
        }
      });
    });
  }
  getCollection(resourceName: string): Collection {
    if (!(resourceName in this.collections)) {
      this.describe(resourceName).then((cls: any) => {
        this.collections[resourceName].cls = cls;
      });
      
      this.collections[resourceName] = new Collection(this, this.touch, null);
    }
    
    return this.collections[resourceName];
  }
}
