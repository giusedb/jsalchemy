let minLevel = 'log';

export class Logger {
  constructor(name) {
    name = name || '';
    const levels = ['log', 'info', 'warn', 'error'];
    const idx = levels.indexOf(minLevel)

    for (let i = 0; i < idx; i++) {
      this[levels[i]] = () => {};
    }

    for (let i = idx; i < levels.length; i++) {
      this[levels[i]] = (...args) => {
        console[levels[i]](name, ...args);
      }
    }
  }
}

export function setLogLevel(name) {
  minLevel = name;
}
