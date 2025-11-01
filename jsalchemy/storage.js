class LocalStorage {
    $storage = {};
    constructor() {
        this.$storage = localStorage;
    }
    get(key) {
        const ret = this.$storage[key];
        if (ret !== undefined) {
            return JSON.parse(ret);
        }
    }
    set(key, value) {
        this.$storage[key] = JSON.stringify(value);
    }
    del(key) {
        delete this.$storage[key];
    }
    has(key) {
        return key in this.$storage;
    }
}

class FileStorage {
    constructor(filename) {
        this.path = require('path');
        this.fs = require('fs');
        this.filename = filename;
        try {
            this.$storage = JSON.parse(this.fs.readFileSync(this.filename, 'utf8'));
        } catch (err) {
            this.$storage = {};
        }
    }
    get(key) {
        const ret = this.$storage[key];
        if (ret !== null) {
            return JSON.parse(ret);
        }
    }
    set(key, value) {
        this.$storage[key] = JSON.stringify(value);
        this.fs.writeFileSync(this.filename, JSON.stringify(this.$storage));
    }
    del(key) {
        delete this.$storage[key];
        this.fs.writeFileSync(this.filename, JSON.stringify(this.$storage));
    }
    has(key) {
        return key in this.$storage;
    }
}

const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

export default isBrowser ? new LocalStorage() : new FileStorage('./storage.json');
