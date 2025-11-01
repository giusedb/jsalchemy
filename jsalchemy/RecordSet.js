class RecordSet {
  constructor(orm, filter, rpp, page, sort) {
    this.orm = orm;
    this.filter = filer;
    this.rpp = rpp;
    this.page = page;
    this.total = 0;
    this.records = [];
    this.sort = sort;
    this.load();
  }
}