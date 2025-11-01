import Lazy from "lazy.js";


export default class VacuumCollector {

    constructor(touch, requested, name, pkIndex) {
        this.requested = requested;
        this.missing = {};
        this.name = name;
        this.pkIndex = pkIndex;
        this.touch = touch;
    }

    request(id, lazy){
        if (this.pkIndex && (id in this.pkIndex.source)) {
            return;
        }
        if (!this.requested.has(id)) {
            this.missing.push(id);
            if (!lazy)
                this.requested.add(id);
            this.touch.touch();
        }
    }

    getRequestedIndex() {
        return this.requested;
    }

    missings() {
        return Lazy(
            this.missing.splice(0,this.missing.length))
            .unique()
            .toArray();
    }

}
