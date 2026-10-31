<script setup>
import { ref, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { videoApi } from '../api'
import VideoCard from '../components/VideoCard.vue'

const route = useRoute()
const category = ref('')
const sort = ref('latest')
const list = ref([])
const page = ref(1)
const hasMore = ref(false)
const loading = ref(false)

const sorts = [
  { key: 'latest', label: '最新' },
  { key: 'hot', label: '最热' },
]

async function load(reset = false) {
  if (reset) page.value = 1
  loading.value = true
  try {
    const data = await videoApi.list({
      page: page.value,
      size: 12,
      category: category.value,
      sort: sort.value,
    })
    list.value = reset ? data.list : [...list.value, ...data.list]
    hasMore.value = data.hasMore
    page.value += 1 // 加载成功后翻页，下一次「加载更多」请求下一页
  } finally {
    loading.value = false
  }
}

function pickSort(s) {
  sort.value = s
  load(true)
}

watch(
  () => route.params.name,
  (n) => {
    category.value = n
    load(true)
  },
)
onMounted(() => {
  category.value = route.params.name
  load(true)
})
</script>

<template>
  <div class="category container">
    <h1 class="page-title reveal">{{ category }}频道</h1>
    <div class="cat-toolbar">
      <div class="sort-tabs">
        <button
          v-for="s in sorts"
          :key="s.key"
          class="sort-tab"
          :class="{ active: sort === s.key }"
          @click="pickSort(s.key)"
        >
          {{ s.label }}
        </button>
      </div>
    </div>

    <div class="grid">
      <VideoCard v-for="(v, i) in list" :key="v.id" :video="v" :index="i" />
    </div>

    <div v-if="!list.length && !loading" class="empty-state">
      <span class="empty-icon">🎞️</span> 该分类暂无视频
    </div>

    <div v-if="hasMore" class="load-more">
      <button class="btn btn-ghost" :disabled="loading" @click="load()">
        {{ loading ? '加载中…' : '加载更多' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.category { padding-top: 8px; }
.cat-toolbar { margin: 18px 0 26px; }
.sort-tabs {
  display: inline-flex;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 4px;
}
.sort-tab {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 600;
  padding: 7px 18px;
  border-radius: 999px;
  transition: all 0.18s;
}
.sort-tab.active { background: var(--accent); color: var(--accent-text); }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 22px;
}
.load-more { text-align: center; margin-top: 34px; }
</style>
