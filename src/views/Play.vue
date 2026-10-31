<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { videoApi, interactionApi, danmakuApi, formatCount, timeAgo, assetUrl } from '../api'
import { useUserStore } from '../stores/user'
import VideoPlayer from '../components/VideoPlayer.vue'
import CommentSection from '../components/CommentSection.vue'
import VideoCard from '../components/VideoCard.vue'
import { gsap, EASE } from '../lib/gsap'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const rootEl = ref(null)
let ctx = null

const video = ref(null)
const related = ref([])
const danmaku = ref([])
const liked = ref(false)
const favorited = ref(false)
const loading = ref(true)
const viewPosted = ref(false)

const videoId = computed(() => route.params.id)
// 播放地址由后端给出：COS/CDN 是绝对地址，本地模式是 /uploads/...（需要补 API 基址）
const src = computed(() => assetUrl(video.value?.url) || '')

// 选集：当前视频在合集剧集中的位置（episodes 已按集数升序）
const episodeIndex = computed(() => {
  const eps = video.value?.collection?.episodes || []
  return eps.findIndex((e) => e.id === video.value.id)
})
const prevEpisode = computed(() => {
  const eps = video.value?.collection?.episodes || []
  const i = episodeIndex.value
  return i > 0 ? eps[i - 1] : null
})
const nextEpisode = computed(() => {
  const eps = video.value?.collection?.episodes || []
  const i = episodeIndex.value
  return i >= 0 && i < eps.length - 1 ? eps[i + 1] : null
})

// 切集：不带 query 跳转，清掉地址栏 ?t=，watch(videoId, load) 自动重载
function goEpisode(ep) {
  if (!ep || ep.id === video.value.id) return
  router.push({ name: 'play', params: { id: ep.id } })
}

// 地址栏 ?t= 续播位置（秒），无则 0
const startTime = computed(() => {
  const t = parseFloat(route.query.t)
  return Number.isFinite(t) && t > 0 ? t : 0
})

// 防录屏动态水印：登录显示昵称，未登录显示「游客」
const watermark = computed(() => userStore.user?.nickname || '游客')

async function load() {
  loading.value = true
  viewPosted.value = false
  // 切换到新视频：重置地址栏进度状态（按当前 URL 的 ?t= 从新开始）
  lastUrlT = startTime.value
  lastUrlWrite = 0
  try {
    const data = await videoApi.detail(videoId.value)
    video.value = data.video
    // 后端详情把合集单独放在 data.collection（不与 video 合并），
    // 选集条靠 v-if="video.collection" 渲染，必须手动挂上去
    video.value.collection = data.collection
    related.value = data.related
    liked.value = data.video.liked
    favorited.value = data.video.favorited
    const dm = await danmakuApi.list(videoId.value)
    danmaku.value = dm.list
    postView()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

function postView() {
  if (viewPosted.value) return
  viewPosted.value = true
  videoApi.view(videoId.value).catch(() => {})
  video.value.views += 1
}

let historyTimer = null
let lastUrlT = startTime.value // 初始即当前地址栏进度，避免首次重复写入
let lastUrlWrite = 0
function onHistory(progress) {
  // 后端观看历史（需登录）
  if (userStore.isLoggedIn()) {
    clearTimeout(historyTimer)
    historyTimer = setTimeout(() => {
      interactionApi.history(videoId.value, progress).catch(() => {})
    }, 800)
  }
  // 地址栏 ?t= 进度（不依赖登录）：节流 ~2s 写入一次
  syncUrlProgress(progress)
}

function syncUrlProgress(progress) {
  const t = Math.round(progress)
  if (t < 2) return
  const dur = video.value?.duration
  // 播放接近片尾视为看完，清掉 ?t=，免得下次又续播到片尾
  if (dur && t >= dur - 8) {
    if (lastUrlT !== 0) {
      lastUrlT = 0
      const { t: _omit, ...rest } = route.query
      router.replace({ query: rest }).catch(() => {})
    }
    return
  }
  const now = Date.now()
  if (t === lastUrlT || now - lastUrlWrite < 2000) return
  lastUrlT = t
  lastUrlWrite = now
  router.replace({ query: { ...route.query, t: String(t) } }).catch(() => {})
}

async function sendDanmaku(payload) {
  if (!userStore.isLoggedIn()) {
    return ElMessage.warning('请先登录再发弹幕')
  }
  try {
    const { danmaku: d } = await danmakuApi.add(videoId.value, payload)
    // 后端已持久化并返回真实 danmaku（带 id），并入规范列表即可；
    // 之前同时 push 进 localDanmaku 与 danmaku，弹幕层合并两份导致一条弹幕显示两次
    danmaku.value = [...danmaku.value, d]
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function toggleLike() {
  if (!requireLogin()) return
  try {
    const r = await interactionApi.like(videoId.value)
    liked.value = r.liked
    video.value.likes = r.likes
  } catch (e) { ElMessage.error(e.message) }
}

async function toggleFavorite() {
  if (!requireLogin()) return
  try {
    const r = await interactionApi.favorite(videoId.value)
    favorited.value = r.favorited
    video.value.favorites = r.favorites
  } catch (e) { ElMessage.error(e.message) }
}

function requireLogin() {
  if (!userStore.isLoggedIn()) {
    ElMessage.warning('请先登录')
    return false
  }
  return true
}

async function share() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    ElMessage.success('链接已复制')
  } catch {
    ElMessage.info(window.location.href)
  }
}

onMounted(load)
watch(videoId, load)

// 页面入场：播放器 / 标题 / 信息栏 / 简介错落浮现
function animateIn() {
  if (!video.value) return
  ctx?.revert()
  ctx = gsap.context(() => {
    const tl = gsap.timeline({ defaults: { ease: EASE } })
    tl.fromTo(
      '.player-wrap',
      { y: 30, opacity: 0, scale: 0.985 },
      {
        y: 0,
        opacity: 1,
        scale: 1,
        duration: 0.7,
        onComplete() {
          // 交还 transform，避免父级 transform 影响弹幕层的 fixed/absolute 子元素
          gsap.set('.player-wrap', { clearProps: 'transform,opacity' })
        },
      },
    )
    tl.fromTo('.episode-bar', { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, '-=0.35')
    tl.fromTo('.play-title', { y: 22, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55 }, '-=0.3')
    tl.fromTo('.play-info-bar', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45 }, '-=0.3')
    tl.fromTo('.play-description', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45 }, '-=0.3')
    tl.fromTo('.comments', { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45 }, '-=0.2')
  }, rootEl.value)
}
watch(video, () => nextTick(() => animateIn()))
onBeforeUnmount(() => ctx?.revert())
</script>

<template>
  <div ref="rootEl" class="play container">
    <template v-if="video">
      <div class="play-layout">
        <!-- 主区 -->
        <div class="play-main">
          <div class="player-wrap">
            <VideoPlayer
              :src="src"
              :poster="assetUrl(video.cover_url)"
              :danmaku="danmaku"
              :start-time="startTime"
              :watermark="watermark"
              @send-danmaku="sendDanmaku"
              @history="onHistory"
            />
          </div>

          <!-- 选集条：视频属于合集时显示 -->
          <div v-if="video.collection" class="episode-bar">
            <div class="episode-bar-top">
              <router-link
                :to="{ name: 'collection', params: { id: video.collection.id } }"
                class="episode-collection"
              >
                <span class="episode-col-icon">📚</span>
                <span class="episode-col-name">{{ video.collection.title }}</span>
                <span class="episode-col-count">{{ video.collection.episode_count }} 集</span>
              </router-link>
              <div class="episode-nav">
                <button
                  class="episode-nav-btn"
                  :disabled="!prevEpisode"
                  @click="goEpisode(prevEpisode)"
                >‹ 上一集</button>
                <button
                  class="episode-nav-btn"
                  :disabled="!nextEpisode"
                  @click="goEpisode(nextEpisode)"
                >下一集 ›</button>
              </div>
            </div>
            <div class="episode-chips">
              <button
                v-for="ep in video.collection.episodes"
                :key="ep.id"
                class="episode-chip"
                :class="{ active: ep.id === video.id }"
                :title="ep.title"
                @click="goEpisode(ep)"
              >
                {{ ep.episode }}
              </button>
            </div>
          </div>

          <h1 class="play-title">{{ video.title }}</h1>

          <div class="play-info-bar">
            <div class="author-box">
              <div class="author-avatar">
                <img v-if="video.author?.avatar" :src="assetUrl(video.author.avatar)" alt="" />
                <span v-else>{{ (video.author?.nickname || '?')[0] }}</span>
              </div>
              <div>
                <div class="author-name">{{ video.author?.nickname || video.author?.name }}</div>
                <div class="meta-text">发布于 {{ timeAgo(video.created_at) }}</div>
              </div>
            </div>

            <div class="action-bar">
              <button class="btn action-btn" :class="{ active: liked }" @click="toggleLike">
                <span>👍</span> 点赞 <b>{{ formatCount(video.likes) }}</b>
              </button>
              <button class="btn action-btn" :class="{ active: favorited }" @click="toggleFavorite">
                <span>⭐</span> 收藏 <b>{{ formatCount(video.favorites) }}</b>
              </button>
              <button class="btn action-btn" @click="share">
                <span>🔗</span> 分享
              </button>
            </div>
          </div>

          <div class="play-description">
            <span class="cat-tag">{{ video.category }}</span>
            <p>{{ video.description || '暂无简介' }}</p>
          </div>

          <CommentSection :video-id="video.id" />
        </div>

        <!-- 侧栏：相关推荐 -->
        <aside class="play-side">
          <div class="side-title"><span class="eyebrow">UP NEXT</span> 相关推荐</div>
          <div class="side-list">
            <VideoCard v-for="(v, i) in related" :key="v.id" :video="v" :index="i" class="side-card" />
            <div v-if="!related.length" class="empty-state">
              <span class="empty-icon">📼</span> 暂无相关视频
            </div>
          </div>
        </aside>
      </div>
    </template>

    <div v-else-if="loading" class="empty-state"><span class="empty-icon">⏳</span> 加载中…</div>
  </div>
</template>

<style scoped>
.play { padding-top: 8px; }
.play-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 28px;
}
.play-main { min-width: 0; }
.player-wrap { border-radius: var(--radius); }

/* 选集条 */
.episode-bar {
  margin: 18px 0 0;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  will-change: transform, opacity;
}
.episode-bar-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.episode-collection {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.episode-col-icon { font-size: 15px; }
.episode-col-name {
  font-size: 15px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.2s;
}
.episode-collection:hover .episode-col-name { color: var(--accent-strong); }
.episode-col-count {
  font-family: var(--font-syne);
  font-size: 12px;
  color: var(--text-faint);
  background: var(--surface-3);
  padding: 2px 9px;
  border-radius: 999px;
  flex-shrink: 0;
}
.episode-nav { display: flex; gap: 8px; flex-shrink: 0; }
.episode-nav-btn {
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  padding: 7px 14px;
  border-radius: 999px;
  transition: all 0.18s;
}
.episode-nav-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-strong);
}
.episode-nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.episode-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 150px;
  overflow-y: auto;
}
.episode-chip {
  min-width: 42px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-dim);
  font-family: var(--font-syne);
  font-size: 13px;
  font-weight: 700;
  border-radius: 9px;
  transition: all 0.16s;
}
.episode-chip:hover {
  border-color: var(--accent);
  color: var(--accent-strong);
}
.episode-chip.active {
  background: var(--accent);
  color: var(--accent-text);
  border-color: transparent;
  box-shadow: 0 3px 10px var(--accent-glow);
}

.play-title {
  font-size: 24px;
  margin: 20px 0 12px;
  line-height: 1.4;
  will-change: transform, opacity;
}

.play-info-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
}
.author-box { display: flex; align-items: center; gap: 12px; }
.author-avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--surface-3);
  display: grid;
  place-items: center;
  font-weight: 900;
  color: var(--accent);
}
.author-avatar img { width: 100%; height: 100%; object-fit: cover; }
.author-name { font-weight: 700; font-size: 15px; }

.action-bar { display: flex; gap: 10px; }
.action-btn { padding: 10px 18px; }
.action-btn b { font-family: var(--font-syne); margin-left: 4px; }
.action-btn.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent-strong);
}
.action-btn.active:nth-of-type(2) {
  background: var(--rose-soft);
  border-color: var(--accent-rose);
  color: var(--accent-rose);
}

.play-description {
  margin: 18px 0 0;
  padding: 16px 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.cat-tag {
  display: inline-block;
  font-size: 12px;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 3px 12px;
  border-radius: 999px;
  margin-bottom: 10px;
}
.play-description p {
  color: var(--text-dim);
  font-size: 14px;
  line-height: 1.8;
  white-space: pre-wrap;
}

/* 侧栏 */
.play-side { min-width: 0; }
.side-title { margin-bottom: 16px; }
.side-list { display: flex; flex-direction: column; gap: 16px; }
.side-card { width: 100%; }

@media (max-width: 960px) {
  .play-layout { grid-template-columns: 1fr; }
}
</style>
