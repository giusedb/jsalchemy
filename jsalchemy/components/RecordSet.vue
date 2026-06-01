<script setup>
import Orm  from '../ts/Orm.js';
import DeferredFetcher from '../ts/DeferredFetcher.ts';

const local = {recordSet: null};
const iOrm = inject('orm');

const emits = defineEmits(['loading', 'records', 'recordSet', 'update:page']);
const props = defineProps({
  resource: String,
  filter: Object,
  sort: { type: Array, default: () => ['~id'] },
  page: { type: Number, default: 1 },
  recordsPerPage: { type: Number, default: 20 },
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

const records = ref([]);
const total = ref(0);
const loading = ref(false);

const initRset = async () => {
  local.rset = await orm.value.query(props.resource, props.filter, props.sort)
  window.rset = local.rset;
  if (props.recordsPerPage)
    local.rset.setRpp(props.recordsPerPage)
  state.records = local.rset.items;
  local.rset.evt.on('records', (recs, totalCount) => {
    records.value = recs;
    total.value = totalCount;
  });
  orm.value.on('got-data', () => {
    local.rset.refresh();
  });
  local.rset.evt.on('loading', (value) => {
    state.loading = value
  });
  local.rset.evt.on('paging', (paging) => {
    if (state.page !== paging.page) {
      state.page = paging.page;
    }
  });
  emits('recordSet', local.rset);
  nextTick(() => {
    local.rset.evt.emit('records', local.rset._items, local.rset.totalCount);
  });
}

onMounted(async () => {
  initRset(props)
});
onUnmounted(() => {
  if (local.rset) {
    console.log('Disposing RSet')
    if (local.rset)
      local.rset.dispose();
  }
})
watch(() => props.page, (newVal, oldVal) => {
  if (newVal !== oldVal) {
    local.rset.setPage(newVal).refresh();
    emits('update:page', newVal);
  }
});
watch(() => props.recordsPerPage, (newVal, oldVal) => {
  if (newVal !== oldVal) {
    local.rset.setRpp(newVal).setPage(1).refresh();
    emits('update:page', 1);
  }
});
watch(() => props.filter, (newVal, oldVal) => {
  if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
    if (local.rset) {
      local.rset.dispose();
      initRset(props);
    }
  }
});
watch(() => props.sort, (newVal, oldVal) => {
  if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
    local.rset.setSort(newVal).setPage(1).refresh();
    emits('update:page', 1);
  }
});
</script>

<template>
  <slot name="default"
        v-bind:records="records"
        v-bind:total="total"
        v-bind:loading="loading">
    ...
  </slot>
</template>

<style scoped>

</style>
