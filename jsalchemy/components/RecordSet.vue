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
    page: {type: Number, default: 1},
    recordPerPage: { type: Number, default: 20},
    localOrm: {type: Orm},
    name: { type: String, mandatory: true},
  },
  data() {
    return {
      recordSet: null,
      records: [],
      touchRecord: 0,
    };
  },
  computed: {
    myOrm() {
      return this.localOrm || this.orm;
    },
    total() {
      return this.recordSet?.totalCount;
    },
  },
  async mounted() {
    this.orm.on('recordset-page-' + this.name, (records) => {
      this.records = records;
    });
    this.recordSet = new RecordSet(this.orm.resources,
        await orm.getModel(this.resource), this.filter, this.name, {
          rpp: this.recordPerPage,
          page: this.page,
          sort: this.sort,
        });
    this.orm.on('received-' + this.resource, () => {
      this.touchRecord++;
    });
    this.orm.on('deleted-' + this.resource, () => {
      this.touchRecord++;
    });
  },
  watch: {
    filter(value) {
      this.recordSet.filter = value;
    },
    sort(value) {
      this.recordSet.sort = value;
    },
    rpp(value) {
      this.recordSet.rpp = value;
    }
  }
}
</script>

<template>
  <slot name="default" v-bind:records="records" v-bind:total="total">
    ...
  </slot>

</template>

<style scoped>

</style>
