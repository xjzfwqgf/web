<script setup>
import { ref, onMounted, watch, onBeforeUnmount, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { videoApi, collectionApi, formatCount, assetUrl } from '../api'
import VideoCard from '../components/VideoCard.vue'
import { gsap, revealFrom, EASE } from '../lib/gsap'

const route = useRoute()
const router = useRouter()
const rootEl = ref(null)
const toolbarEl = ref(null)

const categories = ref([])
const activeCat = ref('全部')
const sort = ref('latest')
const list = ref([])
const page = ref(1)
const hasMore = ref(false)
const loading = ref(false)
const hotVideo = ref(null)
const collections = ref([])

const FALLBACK_COVER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#3a3a3c'/><stop offset='1' stop-color='#1c1c1e'/></linearGradient></defs><rect width='640' height='360' fill='url(#g)'/><text x='320' y='200' font-size='56' text-anchor='middle' fill='#8e8e93'>📚</text></svg>`,
  )

const sorts = [
  { key: 'latest', label: '最新' },
  { key: 'hot', label: '最热' },
]

let ctx = null

// hero 电影感入场 + 滚动视差（hotVideo 异步加载后才渲染）
function animateHero() {
  if (!hotVideo.value) return
  ctx?.revert()
  ctx = gsap.context(() => {
    const tl = gsap.timeline({ defaults: { ease: EASE } })
    tl.fromTo('.hero .eyebrow', { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 })
      .fromTo(
        '.hero-title',
        { y: 46, opacity: 0, filter: 'blur(10px)' },
        { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.75 },
        '-=0.25',
      )
      .fromTo('.hero-desc', { y: 22, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55 }, '-=0.4')
      .fromTo('.hero-meta', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, '-=0.35')
      .fromTo('.hero-play', { y: 14, opacity: 0, scale: 0.95 }, { y: 0, opacity: 1, scale: 1, duration: 0.5 }, '-=0.3')
      .fromTo(
        '.hero-poster',
        { x: 48, opacity: 0, rotate: 3, scale: 0.94 },
        {
          x: 0,
          opacity: 1,
          rotate: 2,
          scale: 1,
          duration: 0.85,
          ease: 'power2.out',
          onComplete() {
            // 清掉内联 transform，交还给 CSS（恢复 hover 旋转效果）
            gsap.set('.hero-poster', { clearProps: 'transform,opacity' })
          },
        },
        '<',
      )

    // 滚动视差
    gsap.to('.hero-glow', {
      yPercent: 36,
      ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.5 },
    })
    gsap.fromTo(
      '.hero-text',
      { y: 0 },
      {
        y: -34,
        ease: 'none',
        scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.5 },
      },
    )
  }, rootEl.value)
}

watch(hotVideo, () => nextTick(() => animateHero()))

async function loadCategories() {
  try {
    const { list: l } = await videoApi.categories()
    categories.value = l
  } catch {}
}

async function load(reset = false) {
  if (reset) page.value = 1
  loading.value = true
  try {
    const data = await videoApi.list({
      page: page.value,
      size: 12,
      category: activeCat.value === '全部' ? undefined : activeCat.value,
      sort: sort.value,
    })
    list.value = reset ? data.list : [...list.value, ...data.list]
    hasMore.value = data.hasMore
    page.value += 1 // 加载成功后翻页，下一次「加载更多」请求下一页
  } finally {
    loading.value = false
  }
}

async function loadHot() {
  try {
    const data = await videoApi.list({ page: 1, size: 1, sort: 'hot' })
    hotVideo.value = data.list[0] || null
  } catch {}
}

async function loadCollections() {
  try {
    const data = await collectionApi.list()
    collections.value = data.list
  } catch {}
}

function pickCat(c) {
  if (c === activeCat.value) return
  activeCat.value = c
  load(true)
}
function pickSort(s) {
  sort.value = s
  load(true)
}

onMounted(() => {
  loadCategories()
  loadHot()
  loadCollections()
  load(true)
  if (toolbarEl.value) revealFrom(toolbarEl.value, { y: 24 })
})

onBeforeUnmount(() => ctx?.revert())
</script>

<template>
  <div ref="rootEl" class="home container">
    <!-- Hero 头图 -->
    <section v-if="hotVideo" class="hero">
      <div class="hero-glow"></div>
      <div class="hero-text">
        <span class="eyebrow">NOW SHOWING · 正在热映</span>
        <h1 class="hero-title display-title">{{ hotVideo.title }}</h1>
        <p class="hero-desc">{{ hotVideo.description || '夜场精选，好片不断。' }}</p>
        <div class="hero-meta">
          <span class="hero-chip">{{ hotVideo.category }}</span>
          <span class="hero-chip">{{ formatCount(hotVideo.views) }} 播放</span>
          <span class="hero-chip">👍 {{ formatCount(hotVideo.likes) }}</span>
        </div>
        <router-link :to="{ name: 'play', params: { id: hotVideo.id } }" class="btn btn-primary hero-play">
          ▶ 立即观看
        </router-link>
      </div>
      <router-link :to="{ name: 'play', params: { id: hotVideo.id } }" class="hero-poster">
        <img :src="assetUrl(hotVideo.cover_url)" :alt="hotVideo.title" />
        <span class="hero-poster-play">▶</span>
      </router-link>
    </section>

    <!-- 合集精选 -->
    <section v-if="collections.length" class="collections">
      <div class="section-head">
        <h2 class="section-title display-title">合集精选</h2>
        <span class="section-sub">按剧集追更，不错过每一集</span>
      </div>
      <div class="collections-scroll">
        <router-link
          v-for="c in collections"
          :key="c.id"
          :to="{ name: 'collection', params: { id: c.id } }"
          class="collection-card"
        >
          <div class="collection-cover">
            <img
              :src="assetUrl(c.cover_url) || FALLBACK_COVER"
              :alt="c.title"
              loading="lazy"
              @error="(e) => (e.target.src = FALLBACK_COVER)"
            />
            <span class="collection-count">{{ c.episode_count }} 集</span>
          </div>
          <div class="collection-body">
            <h3 class="collection-title">{{ c.title }}</h3>
            <p v-if="c.description" class="collection-desc">{{ c.description }}</p>
          </div>
        </router-link>
      </div>
    </section>

    <!-- 分类 + 排序 -->
    <div ref="toolbarEl" class="toolbar">
      <div class="chips">
        <button class="chip" :class="{ active: activeCat === '全部' }" @click="pickCat('全部')">全部</button>
        <button
          v-for="c in categories"
          :key="c.name"
          class="chip"
          :class="{ active: activeCat === c.name }"
          @click="pickCat(c.name)"
        >
          {{ c.name }}<span class="chip-count">{{ c.count }}</span>
        </button>
      </div>
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

    <!-- 视频网格 -->
    <div class="grid">
      <VideoCard v-for="(v, i) in list" :key="v.id" :video="v" :index="i" />
    </div>

    <div v-if="!list.length && !loading" class="empty-state">
      <span class="empty-icon">🎬</span> 这里还空空如也
    </div>

    <div v-if="hasMore" class="load-more">
      <button class="btn btn-ghost" :disabled="loading" @click="load()">
        {{ loading ? '加载中…' : '加载更多' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.home { padding-top: 8px; }

/* Hero */
.hero {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  border-radius: var(--radius);
  overflow: hidden;
  padding: 44px 48px;
  margin-bottom: 34px;
  background: var(--nav-bg);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-card);
}
.hero-glow {
  position: absolute;
  right: -80px;
  top: -120px;
  width: 520px;
  height: 420px;
  background: radial-gradient(ellipse at center, var(--accent-glow), transparent 65%);
  filter: blur(20px);
  pointer-events: none;
  will-change: transform;
}
.hero-text {
  position: relative;
  z-index: 2;
  max-width: 520px;
  will-change: transform;
}
.hero-title {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: clamp(30px, 4.4vw, 58px);
  letter-spacing: -0.03em;
  line-height: 1.05;
  margin: 14px 0 10px;
  will-change: transform, opacity, filter;
}
.hero-desc {
  color: var(--text-dim);
  font-size: 15px;
  line-height: 1.7;
  margin-bottom: 16px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.hero-meta { display: flex; gap: 10px; margin-bottom: 22px; }
.hero-chip {
  font-family: var(--font-syne);
  font-size: 12px;
  color: var(--text-dim);
  border: 1px solid var(--border-strong);
  padding: 4px 12px;
  border-radius: 999px;
}
.hero-play { padding: 12px 26px; font-size: 15px; animation: pulseGlow 3s ease infinite; }

.hero-poster {
  position: relative;
  z-index: 2;
  width: min(320px, 38vw);
  will-change: transform, opacity;
  border-radius: 16px;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-card);
  transform: rotate(2deg);
  transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}
.hero:hover .hero-poster { transform: rotate(0deg) scale(1.02); }
.hero-poster img { display: block; width: 100%; aspect-ratio: 16/9; object-fit: cover; }
.hero-poster-play {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 50px;
  color: #fff;
  text-shadow: 0 4px 24px rgba(0, 0, 0, 0.6);
  background: radial-gradient(circle, rgba(0,0,0,0.2), transparent 70%);
  opacity: 0;
  transition: opacity 0.3s;
}
.hero-poster:hover .hero-poster-play { opacity: 1; }

/* 合集精选 */
.collections { margin-bottom: 34px; }
.section-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 18px;
}
.section-title { font-size: 24px; }
.section-sub { color: var(--text-faint); font-size: 13px; }

.collections-scroll {
  display: flex;
  gap: 18px;
  overflow-x: auto;
  padding: 4px 4px 10px;
  scroll-snap-type: x proximity;
  scrollbar-width: none;
}
.collections-scroll::-webkit-scrollbar { display: none; }

.collection-card {
  flex: 0 0 260px;
  scroll-snap-align: start;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.28s, border-color 0.28s;
}
.collection-card:hover {
  transform: translateY(-4px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-card-lg), 0 0 0 1px var(--border-strong);
}
.collection-cover {
  position: relative;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: var(--surface-2);
}
.collection-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}
.collection-card:hover .collection-cover img { transform: scale(1.06); }
.collection-count {
  position: absolute;
  right: 8px;
  bottom: 8px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-family: var(--font-syne);
  font-size: 12px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
  backdrop-filter: blur(4px);
  letter-spacing: 0.04em;
}
.collection-body { padding: 12px 14px 14px; }
.collection-title {
  font-size: 15px;
  font-weight: 700;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.2s;
}
.collection-card:hover .collection-title { color: var(--accent-strong); }
.collection-desc {
  margin-top: 5px;
  font-size: 13px;
  color: var(--text-faint);
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 工具栏 */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 26px;
}
.chips { display: flex; gap: 8px; flex-wrap: wrap; }
.chip {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 999px;
  transition: all 0.18s ease;
}
.chip:hover { color: var(--text); border-color: var(--border-strong); }
.chip.active {
  background: var(--accent);
  color: var(--accent-text);
  border-color: transparent;
  font-weight: 700;
}
.chip-count { margin-left: 6px; font-family: var(--font-syne); font-size: 11px; opacity: 0.65; }

.sort-tabs {
  display: flex;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 4px;
  flex-shrink: 0;
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

/* 网格 */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 22px;
}

.load-more { text-align: center; margin-top: 34px; }

/* 暗色适配：hero 玻璃随主题走。hero 背景/边框已用 var(--nav-bg)/var(--border-strong)，
   随 html[data-theme] 自动换浅/暗玻璃，无需额外覆盖（scoped :global() 尾随选择器会加载失败） */

@media (max-width: 720px) {
  .hero { flex-direction: column-reverse; padding: 26px; }
  .hero-poster { width: 100%; transform: none; }
}

/* 浅色主题下 hero 玻璃偏薄会洗平层次，提一档不透明度兼可读性（Apple 原则12） */
:global(html[data-theme='light']) .hero { background: rgba(255, 255, 255, 0.8); }

/* 减少透明度的用户偏好：hero 玻璃变实底 */
@media (prefers-reduced-transparency: reduce) {
  .hero {
    background: var(--surface);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
</style>
