<script setup>
import { ref, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { videoApi } from '../api'
import VideoCard from '../components/VideoCard.vue'

const route = useRoute()
const keyword = ref('')
const list = ref([])
const page = ref(1)
const hasMore = ref(false)
const total = ref(0)
const loading = ref(false)

async function load(reset = false) {
  if (reset) page.value = 1
  loading.value = true
  try {
    const data = await videoApi.list({ page: page.value, size: 12, keyword: keyword.value })
    list.value = reset ? data.list : [...list.value, ...data.list]
    hasMore.value = data.hasMore
    total.value = data.total
    page.value += 1 // 加载成功后翻页，下一次「加载更多」请求下一页
  } finally {
    loading.value = false
  }
}

watch(
  () => route.query.keyword,
  (k) => {
    keyword.value = k || ''
    load(true)
  },
)
onMounted(() => {
  keyword.value = route.query.keyword || ''
  load(true)
})
</script>

<template>
  <div class="search container">
    <h1 class="page-title reveal">
      搜索
      <span class="keyword-quote" v-if="keyword">「{{ keyword }}」</span>
    </h1>
    <div class="meta-text result-count">共找到 {{ total }} 个结果</div>

    <div class="grid">
      <VideoCard v-for="(v, i) in list" :key="v.id" :video="v" :index="i" />
    </div>

    <div v-if="!list.length && !loading" class="empty-state">
      <span class="empty-icon">🔍</span> 没有找到相关视频
    </div>

    <div v-if="hasMore" class="load-more">
      <button class="btn btn-ghost" :disabled="loading" @click="load()">
        {{ loading ? '加载中…' : '加载更多' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.search { padding-top: 8px; }
.keyword-quote { color: var(--accent); font-weight: 900; }
.result-count { margin: 14px 0 26px; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 22px;
}
.load-more { text-align: center; margin-top: 34px; }
</style>
