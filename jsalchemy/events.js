import 'lodash'

export class NamedEventManager {

    constructor() {
        this.events = {};
        this.handlerId = {};
        this.idxId = 0;
    }

    /**
     * Binds a named-event with the handler to be called when the event is emitted and returns the
     * unique id of the binding. See unbind
     * @param name - the name of the event
     * @type name {String}
     * @param func - the `function` to execute
     * @type func {Function}
     * @param ths - what will be associated to `this` when called
     * @returns {number}
     */
    on(name, func, ths) {
        const key = [func, ths];
        if (!(name in this.events)) {
            this.events[name] = [];
        }
        const id = this.idxId++;
        this.events[name].push(key);
        this.handlerId[id] = key;
        return id;
    }

    /**
     * Emit the named event event
     * @param name - the `name` of the event to emit
     * @param args - all arguments to be passed to the handlers
     */
    emit(name, ...args) {
        if (name in this.events) {
            this.events[name].forEach(event => {
                try {
                    event[0].apply(event[1], args);
                } catch (e) {
                    console.error(e);
                }
            });
        }
    }

    /**
     * unbinds the event handler from the event
     * @param handler - identifies the handler to un-bind, either via ID or by function
     * @type handler [{String, Number}]
     * @returns {number}
     */
    unbind(handler) {
        let count = 0;
        if (handler in this.handlerId) {
            let func = this.handlerId[handler + ''];
            _(this.events).each(v => {
                const idx = [];
                for (let n in v) {
                    if (v[n] === func) {
                        idx.push(n);
                        count++;
                    }
                }
                idx.reverse().forEach(x => { v.splice(x, 1) });
            });
        }
        delete this.handlerId[handler];
        return count;
    }

    once(eventName, handlerFunction) {
        const self = this;
        const handler = this.on(eventName, function(){
            handlerFunction.apply(this, arguments);
            self.unbind(handler);
        });
    }
}