import { ResourceManager } from "./resources.js";
import { NamedEventManager } from "./events.js";
import RecordSet from "./RecordSet.js";

/**
 * ORM options
 *  - endoint: String identifies the main entry point of the SQLAlchemy-js server
 *  - autologin: Boolean re-login after loosing its connection
 */
export class Orm {

    #resources = null;
    $events = null;

    constructor(options, eventHandlers, reactive) {
        Object.assign(this, options);
        this.connected = false;
        this.$events = new NamedEventManager();
        this.on = this.$events.on.bind(this.$events);
        for (const [event, handler] of Object.entries(eventHandlers)) {
            this.on(event, handler);
        }

        this.emit = this.$events.emit.bind(this.$events)

        this.on('connected', () => { this.connected = true });
        this.on('disconnected', () => { this.connected = false; });

        this.#resources = this.resources = new ResourceManager(this, options);
        this.conn = this.#resources.connection;
        // TODO: continue this constructor
        this.get = this.#resources.get.bind(this.#resources);
        this.getModel = this.#resources.describe.bind(this.#resources);
        this.collections = this.#resources.collections;
        this.reactive = reactive;
    }

    async login(username, password) {
        const status = await this.conn.login(username, password);
        return status.user || status
    }

    async logout() {
        const ret = await this.conn.logout();
        this.user = null;
        return ret === 'Ok';
    }

    /**
     * Finds the model and returns the model's class
     * @param modelName {String}
     * @returns {Promise<Object>}
     */
    getModel(modelName) {
        return this.resources.describe(modelName);
    }

    /**
     * Asynchronously gets the objects by it's ID
     * @param modelName {String} - the model you want data from
     * @param ids {Number | Array[Number]} - the ID or IDs you want to get
     * @returns {Promise<*>}
     */
    get(modelName, ids) {
        return this.resources.get(modelName, ids);
    }

    /**
     * Performs more complex queries, based on the `filter`
     * @param modelName {String} - the name of the `model`
     * @param filter {Object}
     * @param sort {Array<Array<String>>}
     * @returns {Promise<Array<any>>}
     */
    query(modelName, filter, sort='id') {
        return this.resources.query(modelName, filter, sort);
    }

    async delete(...objects) {
      if ((objects.length === 2) && (typeof objects[0] === 'string') && (Array.isArray(objects[1]))) {
        _.chunk(objects[1], (await this.getModel(objects[0])).rpp).forEach(chunk => {
          return this.resources.delete(objects[0], chunk);
        });
        return;
      }
      const byClass = _(objects).groupBy('constructor.name');
      for (let [resourceName, objs] of _(byClass).entries()) {
        let resource = await this.getModel(resourceName);
        _.chunk(objs, resource.rpp).forEach(async (chunk) => {
          await this.resources.delete(resourceName, objs.map(obj => obj.$pk));
        });
      }
    }
}

Object.defineProperty(Orm.prototype, 'user', {
    get() {
        return this.conn.status.user;
    }
})
