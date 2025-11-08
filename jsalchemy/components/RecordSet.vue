<script>
import { Orm } from "../orm.js";
import 'lodash';
import utils from '../utils.js';

export default {
  inject: {
    orm: {default: null, type: Orm},
  },
  props: {
    resource: {type: String, mandatory: true},
    filter: {type: [Object, null], default: null},
    sort: {type: [String, Array], default: () => {return []}},
    localOrm: {type: Orm},
  },
  data() {
    return {
      collection: null,
      touchRecord: 0,
    };
  },
  computed: {
    items() {
      const touch = this.touchRecord;
      if (!this.collection)
        return [];
      const sort = Array.isArray(this.sort) ? this.sort : [this.sort];
      const direction = sort.map(x => x.startsWith('~') ? 'desc': 'asc');
      const sortStrings = sort.map(x => x.startsWith('~') ? x.substring(1) : x);
      return _(this.collection.rows)
        .filter(this.filterFunc)
        .orderBy(sortStrings, direction)
        .value();
    },
    filterFunc() {
      return utils.makeFilter(this.filter);
    },
    myOrm() {
      return this.localOrm || this.orm;
    }
  },
  methods: {
    async fetch() {
      if (!this.myOrm.user) { return }
      await this.myOrm.query(this.resource, this.filter, this.sort);
      this.collection = this.myOrm.resources.getCollection(this.resource);
    }
  },
  mounted() {
    this.fetch();
    this.orm.on('received-' + this.resource, () => {
      this.touchRecord++;
    });
    this.orm.on('deleted-' + this.resource, () => {
      this.touchRecord++;
    })
  },
}
</script>

<template>
  <slot name="default" v-bind:records="items">
    ...
  </slot>

</template>

<style scoped>

</style>
