import {Logger} from "./logger.js";


/**
 * Autolinker fetches the missing data collected by the VacuumCollector
 */
export const autoLinker = (resourceManager) => {

  const log = new Logger('autoLinker')

  const linkUnlinked = () => {
    if (!resourceManager.touch.touched)
      return
    log.log('check...')
    for (let [modelName, collection] of Object.entries(resourceManager.collections)) {
      for (let filter of collection.getMissingFilters()) {
        if (Array.isArray(filter)) {
          resourceManager.verb(modelName, 'm2m', filter[0]).then(res => {
            let ref = filter[1];
            let secondFilter = {};
            let fIndex = resourceManager.getCollection(modelName).getIndex(filter[0].attribute);
            secondFilter[ref.foreign_attribute] = [...filter[0].keys
              .map(fIndex.get.bind(fIndex))
              .reduce((i,a) => i.union(a))
            ];
            resourceManager.query(ref.resource, secondFilter)
          })
        } else {
          resourceManager.query(modelName, filter);
        }
      }
    }
  }
  log.info('Starting ...')
  setInterval(linkUnlinked, 50);
};

