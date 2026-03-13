import {ResourceManager} from "./ResourceManager";
import collection from "./Collection";

export class Autolinker {
    resMan: ResourceManager;
    private timeHandler: number;

    constructor(resMan: ResourceManager) {
        this.resMan = resMan;
    }

    linkUnlinked() {
        if (!this.resMan.touch.touched)
            return
        for (let [name, coll] of Object.entries(this.resMan.collections)) {
            let missing = coll.getMissingFilters();
            if (missing) {
                this.resMan.verb(name, 'get', {pks: missing});
            }
            let queries = coll.missingQueries
            if (queries.length === 1) {
                this.resMan.verb(name, 'query', queries[0][1].filterFor(queries[0][0]), true)
                    .then((result: string[][]) => {
                        queries[0][1].pushPage(queries[0][0], result)
                    });
            } else if (queries.length > 1) {
                this.resMan.verb(name, 'query', {multiple: queries.map(([nPage, pager]) => pager.filterFor(nPage))}, true)
                    .then((result: string[][]) => {
                        for (let i = 0; i < queries.length; i++) {
                            queries[i][1].pushPage(queries[i][0], result[i])
                        }
                    });
            }
        }
    }

    start(interval: number = 50) {
        this.timeHandler = setInterval(this.linkUnlinked.bind(this), interval)
    }

    stop() {
        clearInterval(this.timeHandler);
        this.timeHandler = null;
    }
}