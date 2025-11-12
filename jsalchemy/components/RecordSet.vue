<script setup>
import { Orm } from "../orm.js";
import 'lodash';
import utils from '../utils.js';

const emits = defineEmits(['loading', 'records']);
const local = {recordSet: null};
const iOrm = inject('orm');
const props = defineProps({
  resource: String,
  filter: Object,
  sort: Array,
  page: Number,
  recordsPerPage: Number,
  localOrm: { type: [Orm, null], default: null },
  name: String,
});

const state = reactive({
  records: [],
  touchRecord: 0,
  total: 0,
  loading: false,
});


const orm = computed(() => {
  return props.localOrm || iOrm;
});

const total = computed(() => {
  return local.recordSet?.totalCount;
});

onMounted(() => {
  orm.value.on('received-' + props.resource, () => {
    state.touchRecord++;
  });
  orm.value.on('deleted-' + props.resource, () => {
    state.touchRecord++;
  });

  local.recordSet = new RecordSet(orm.value.resources, props.resource, props.filter, props.name, {
    page: 1,
    rpp: props.recordsPerPage,
    sort: props.sort,
  });
  local.recordSet.on('results', (recs, totalCount) => {
    if (recs.length === state.records.length) {
      for (let i = 0; i < recs.length; i ++) {
        state.records[i] = recs[i];
      }
    } else {
      state.records.length = 0;
      state.records.push(...recs);
    }
    state.totalCount = totalCount;
  });
  local.recordSet.on('loading', (value) => {
    state.loading = value
  });
});

watch(() => props.page, (newVal, oldVal) => {
  if (newVal !== oldVal)
    local.recordSet.page = newVal;
});
watch(() => props.recordsPerPage, (newVal, oldVal) => {
  if (newVal !== oldVal)
    local.recordSet.rpp = newVal;
});
watch(() => props.filter, (newVal, oldVal) => {
  if (JSON.stringify(newVal) !== JSON.stringify(oldVal))
    local.recordSet.filter = newVal;
});
watch(() => props.sort, (newVal, oldVal) => {
  if (JSON.stringify(newVal) !== JSON.stringify(oldVal))
    local.recordSet.sort = newVal;
});

</script>

<template>
  <slot name="default" v-bind:records="state.records" v-bind:total="state.totalCount" v-bind:loading="state.loading">
    ...
  </slot>

</template>

<style scoped>

</style>
