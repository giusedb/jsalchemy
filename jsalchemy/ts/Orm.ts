// orm.ts

// Type definitions
import {NamedEventManager} from "./NamedEventManager";
import {ResourceManager} from "./ResourceManager";
import {JSAlchemyConnection} from "../connection";
import {ICollections, IResource, IResourceClass} from "./interfaces";
import {groupBy, indexBy} from "./utils";
import RSet from "./RSet";

interface OrmOptions {
  endpoint?: string;
  autologin?: boolean;
  reactive: Function;
}

interface EventHandlers {
  [key: string]: (...args: any[]) => void;
}

interface ModelDescription {
  rpp: number;
  [key: string]: any;
}

interface ResourceObject {
  $pk: number;
  [key: string]: any;
}

/**
 * ORM options
 * - endpoint: String identifies the main entry point of the SQLAlchemy-js server
 * - autologin: Boolean re-login after loosing its connection
 */
export default class Orm {
  // Private fields with proper typing
  $events: NamedEventManager;

  // Public fields with typing
  connected: boolean = false;
  endpoint?: string;
  autologin?: boolean;
  reactive: any;
  resources: ResourceManager;
  conn: JSAlchemyConnection;
  collections: ICollections
  on: (event: string, handler: Function) => void;
  emit: (event: string, ...anything: any) => void;

  constructor(options: OrmOptions, eventHandlers: EventHandlers = {}) {
    Object.assign(this, options);
    this.$events = new NamedEventManager();

    // Bind event handling methods
    this.on = this.$events.on.bind(this.$events);
    this.emit = this.$events.emit.bind(this.$events);

    // Register event handlers
    for (const [event, handler] of Object.entries(eventHandlers)) {
      this.on(event, handler);
    }

    // Set up connection status events
    this.on('connected', () => { this.connected = true });
    this.on('disconnected', () => {
      this.connected = false;
    });

    // Initialize resources
    this.resources = new ResourceManager(this, options);
    this.conn = this.resources.connection;

    // Bind resource methods
    this.get = this.resources.get.bind(this.resources);
    this.getModel = this.resources.describe.bind(this.resources);
    this.collections = this.resources.collections;
  }

  /**
   * Login to the ORM system
   */
  async login(username: string, password: string): Promise<any> {
    const status = await this.conn.login(username, password);
    return status.user || status;
  }

  /**
   * Logout from the ORM system
   */
  async logout(): Promise<boolean> {
    const ret = await this.conn.logout();
    this.user = null;
    return ret === 'Ok';
  }

  /**
   * Finds the model and returns the model's class
   * @param modelName {String}
   * @returns {Promise<Object>}
   */
  async getModel(modelName: string): Promise<ModelDescription> {
    return this.resources.describe(modelName);
  }

  /**
   * Asynchronously gets the objects by it's ID
   * @param modelName {String} - the model you want data from
   * @param ids {Number | Array<Number>} - the ID or IDs you want to get
   * @returns {Promise<any>}
   */
  async get(modelName: string, ids: number | number[]): Promise<IResource | IResource[]> {
    const ret = this.resources.get(modelName, ids);
    if (Array.isArray(ids))
      return ret
    else
      return ret[0];
  }

  /**
   * Performs more complex queries, based on the `filter`
   * @param resourceName {String} - the name of the resource
   * @param filter {Object}
   * @param sort {Array<Array<String>>}
   * @returns {Promise<RSet>}
   */
  async query(resourceName: string, filter: any, sort: string[] = ['id']): Promise<RSet> {
    // get model default rpp
    const res = await this.resources.describe(resourceName);
    return new RSet(this.resources, resourceName, filter, sort);
  }

  /**
   * Delete objects from the database
   */
  async delete(...objects: any[]): Promise<number> {
    if ((objects.length === 2) && (typeof objects[0] === 'string') && (Array.isArray(objects[1]))) {
      const model = await this.getModel(objects[0]);
      const chunks = this.chunkArray(objects[1], model.rpp);

      for (const chunk of chunks) {
        await this.resources.delete(objects[0], chunk);
      }

      return;
    }

    // Group objects by constructor name
    const byClass: Record<string, any[]> = groupBy(objects, x => x.constructor.name)

    let numDeleted = 0;
    // Process each class group
    for (const [resourceName, objs] of Object.entries(byClass)) {
      const resource = await this.getModel(resourceName);
      const chunks = this.chunkArray(objs, resource.rpp);

      for (const chunk of chunks) {
        const pkValues = chunk.map((obj: ResourceObject) => obj.$pk);
        await this.resources.delete(resourceName, pkValues);
        numDeleted += pkValues.length;
      }
    }
    return numDeleted;
  }

  async saveBulk(items: IResource[]) {
      const byClass: Record<string, IResource[]> = groupBy(items, (x) => x.constructor.name);
      const results = [];
      for (let [resourceName, items] of Object.entries(byClass)) {
          let cls = this.resources.classCache[resourceName];
          for (let chunk of this.chunkArray(items, cls.rpp)) {
              let result = await this.resources.verb(
                  resourceName, 'bulk',
                  {records: chunk.map(item => item.$raw)},
                  true, true
              )
              const newKeys = result.new ? result.new[resourceName].map(cls.getPk) : [];
              const updatedKeys = result.update ? result.update[resourceName].map(cls.getPk) : [];
              this.resources.gotData(result);
              let keys = [...updatedKeys, ...newKeys];
              if (keys.length)
                  results.push(...this.resources.collections[resourceName].get(...keys))
          }
      }
      return results;
  }

  /**
   * Helper method to chunk arrays
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }

    return chunks;
  }

  // Getter for user property
  get user(): any {
    return this.conn.status.user;
  }
}
