<script setup>
import { Orm } from "../orm.js";
import RSet from '../RSet.js';
import 'lodash';

const emits = defineEmits(['loading', 'records', 'recordSet']);
const props = defineProps({
  resource: String,
  filter: Object,
  sort: Array,
  page: Number,
  recordsPerPage: Number,
  localOrm: { type: [Orm, null], default: null },
  name: String,
});
const local = {recordSet: null};
const iOrm = inject('orm');
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
  local.recordSet = new RSet(orm.value.resources, props.resource, props.filter, {
    page: 1,
    rpp: props.recordsPerPage,
    sort: props.sort,
  }, props.name);
  local.recordSet.on('records', (recs, totalCount) => {
    if (recs.length === state.records.length) {
      for (let i = 0; i < recs.length; i ++) {
        if (recs[i])
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
  local.recordSet.on('paging', (paging) => {
    if (state.page !== paging.page) {
      state.page = paging.page;
    }
  });
  emits('recordSet', local.recordSet);
});
onUnmounted(() => {
  if (local.recordSet)
    local.recordSet.destroy();
})

watch(() => props.page, (newVal, oldVal) => {
  if (newVal !== oldVal)
    local.recordSet.page = newVal;
});
watch(() => props.recordsPerPage, (newVal, oldVal) => {
  if (newVal !== oldVal) {
    local.recordSet.rpp = newVal;
    local.recordSet.page = 1;
  }
});
watch(() => props.filter, (newVal, oldVal) => {
  if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
    local.recordSet.filter = newVal;
    local.recordSet.page = 1;
  }
});
watch(() => props.sort, (newVal, oldVal) => {
  if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
    local.recordSet.sort = newVal;
    local.recordSet.page = 1;
  }
});

</script>

<template>
  <slot name="default" v-bind:records="state.records" v-bind:total="state.totalCount" v-bind:loading="state.loading">
    ...
  </slot>

</template>

<style scoped>

</style>
