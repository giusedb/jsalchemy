export default class Toucher {
    _touched = null;

    constructor() {
        this._touched = false;
    }

    touch () {
        this._touched = true;
    }


    get touched() {
        let t = this._touched;
        this._touched = false;
        return t;
    }
}
