<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { collectionApi, formatCount, assetUrl } from '../api'
import VideoCard from '../components/VideoCard.vue'
import { revealFrom } from '../lib/gsap'

const route = useRoute()
const collection = ref(null)
const loading = ref(true)

const FALLBACK_COVER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#3a3a3c'/><stop offset='1' stop-color='#1c1c1e'/></linearGradient></defs><rect width='640' height='360' fill='url(#g)'/><text x='320' y='200' font-size='56' text-anchor='middle' fill='#8e8e93'>📚</text></svg>`,
  )

async function load() {
  loading.value = true
  try {
    const data = await collectionApi.detail(route.params.id)
    collection.value = data.collection
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  load()
  if (document.querySelector('.col-banner')) revealFrom(document.querySelector('.col-banner'), { y: 24 })
})
</script>

<template>
  <div class="collection container">
    <template v-if="collection">
      <!-- 横幅 -->
      <section class="col-banner">
        <div class="col-glow"></div>
        <div class="col-cover">
          <img
            :src="assetUrl(collection.cover_url) || FALLBACK_COVER"
            :alt="collection.title"
            @error="(e) => (e.target.src = FALLBACK_COVER)"
          />
        </div>
        <div class="col-text">
          <span class="eyebrow">COLLECTION · 合集</span>
          <h1 class="col-title display-title">{{ collection.title }}</h1>
          <p v-if="collection.description" class="col-desc">{{ collection.description }}</p>
          <div class="col-meta">
            <span class="col-chip">📚 {{ collection.episode_count }} 集</span>
            <span class="col-chip">▶ {{ formatCount(collection.episodes.reduce((s, e) => s + (e.views || 0), 0)) }} 总播放</span>
          </div>
        </div>
      </section>

      <!-- 剧集网格 -->
      <div class="col-head">
        <h2 class="col-grid-title">剧集列表</h2>
        <span class="col-grid-sub">共 {{ collection.episodes.length }} 集</span>
      </div>
      <div class="grid">
        <VideoCard
          v-for="(v, i) in collection.episodes"
          :key="v.id"
          :video="v"
          :index="i"
        />
      </div>
      <div v-if="!collection.episodes.length" class="empty-state">
        <span class="empty-icon">📼</span> 该合集还没有剧集
      </div>
    </template>

    <div v-else-if="loading" class="empty-state"><span class="empty-icon">⏳</span> 加载中…</div>
    <div v-else class="empty-state"><span class="empty-icon">📚</span> 合集不存在</div>
  </div>
</template>

<style scoped>
.collection { padding-top: 8px; }

/* 横幅 */
.col-banner {
  position: relative;
  display: flex;
  align-items: center;
  gap: 28px;
  border-radius: var(--radius);
  overflow: hidden;
  padding: 32px 36px;
  margin-bottom: 30px;
  background: var(--surface);
  border: 1px solid var(--border);
}
.col-glow {
  position: absolute;
  right: -60px;
  top: -120px;
  width: 460px;
  height: 380px;
  background: radial-gradient(ellipse at center, var(--accent-glow), transparent 65%);
  filter: blur(20px);
  pointer-events: none;
}
.col-cover {
  position: relative;
  flex-shrink: 0;
  width: min(300px, 34vw);
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-card);
}
.col-cover img { display: block; width: 100%; aspect-ratio: 16/9; object-fit: cover; }
.col-text { position: relative; z-index: 2; min-width: 0; }
.col-title { font-size: clamp(22px, 3vw, 34px); margin: 12px 0 8px; }
.col-desc {
  color: var(--text-dim);
  font-size: 14px;
  line-height: 1.7;
  margin-bottom: 16px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.col-meta { display: flex; gap: 10px; flex-wrap: wrap; }
.col-chip {
  font-family: var(--font-syne);
  font-size: 12px;
  color: var(--text-dim);
  border: 1px solid var(--border-strong);
  padding: 4px 12px;
  border-radius: 999px;
}

/* 剧集网格 */
.col-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 18px;
}
.col-grid-title { font-size: 20px; }
.col-grid-sub { font-size: 13px; color: var(--text-faint); }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 22px;
}

@media (max-width: 720px) {
  .col-banner { flex-direction: column; padding: 22px; text-align: center; }
  .col-cover { width: 100%; }
  .col-meta { justify-content: center; }
}
</style>
