// events.ts

type EventHandler = (...args: any[]) => void;

interface EventMap {
  [key: string]: [EventHandler, any][];
}

interface HandlerIdMap {
  [key: number]: [EventHandler, any];
}

/**
 * A named event manager that allows binding and emitting events
 */
export class NamedEventManager {
  private events: EventMap = {};
  private handlerId: HandlerIdMap = {};
  private idxId: number = 0;

  /**
   * Binds a named-event with the handler to be called when the event is emitted and returns the
   * unique id of the binding.
   * @param name - the name of the event
   * @param func - the function to execute
   * @param ths - what will be associated to `this` when called
   * @returns {number} The unique id of the binding
   */
  on(name: string, func: EventHandler, ths?: any): number {
    const key: [EventHandler, any] = [func, ths];
    
    if (!(name in this.events)) {
      this.events[name] = [];
    }
    
    const id = this.idxId++;
    this.events[name].push(key);
    this.handlerId[id] = key;
    
    return id;
  }

  /**
   * Emit the named event
   * @param name - the name of the event to emit
   * @param args - all arguments to be passed to the handlers
   */
  emit(name: string, ...args: any[]): void {
    if (name in this.events) {
      for (const [func, ths] of this.events[name]) {
        try {
          func.apply(ths, args);
        } catch (e) {
          console.error(e);
        }
      }
    }
  }

  /**
   * Unbinds the event handler from the event
   * @param handler - identifies the handler to un-bind, either via ID or by function
   * @returns {number} The number of unbound handlers
   */
  unbind(handler: string | number): number {
    let count = 0;
    
    if (handler in this.handlerId) {
      const func = this.handlerId[handler as number];
      
      Object.values(this.events).forEach(eventArray => {
        const indicesToRemove: number[] = [];
        
        for (let i = 0; i < eventArray.length; i++) {
          if (eventArray[i] === func) {
            indicesToRemove.push(i);
            count++;
          }
        }
        
        // Remove in reverse order to maintain correct indices
        indicesToRemove.reverse().forEach(index => {
          eventArray.splice(index, 1);
        });
      });
    }
    
    delete this.handlerId[handler as number];
    return count;
  }

  /**
   * Bind an event handler that will only be called once
   * @param eventName - the name of the event to bind to
   * @param handlerFunction - the function to execute when the event is emitted
   */
  once(eventName: string, handlerFunction: EventHandler): void {
    const self = this;
    
    const handler = this.on(eventName, function(...args: any[]) {
      handlerFunction.apply(this, args);
      self.unbind(handler);
    });
  }
}
