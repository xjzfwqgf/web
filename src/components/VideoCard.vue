<script setup>
import { ref, onMounted } from 'vue'
import { formatCount, formatDuration, assetUrl } from '../api'
import { revealFrom } from '../lib/gsap'

const props = defineProps({
  video: { type: Object, required: true },
  index: { type: Number, default: 0 },
  showProgress: { type: Boolean, default: false },
})

const el = ref(null)

onMounted(() => {
  // 滚动进入视口时交错浮入（ref 在 <router-link> 组件上，需取 $el 拿真实 DOM）
  const node = el.value?.$el ?? el.value
  if (node) revealFrom(node, { y: 40, delay: Math.min(props.index, 12) * 0.045 })
})

const FALLBACK_COVER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#2c2c2e'/><stop offset='1' stop-color='#1c1c1e'/></linearGradient></defs><rect width='640' height='360' fill='url(#g)'/><text x='320' y='200' font-size='56' text-anchor='middle' fill='#6e6e73'>▶</text></svg>`,
  )
</script>

<template>
  <router-link
    ref="el"
    :to="{ name: 'play', params: { id: video.id }, query: {} }"
    class="vcard"
  >
    <div class="vcard-cover">
      <img
        :src="assetUrl(video.cover_url) || FALLBACK_COVER"
        :alt="video.title"
        loading="lazy"
        @error="(e) => (e.target.src = FALLBACK_COVER)"
      />
      <span class="vcard-duration">{{ formatDuration(video.duration) }}</span>
      <span v-if="video.episode > 0" class="vcard-episode">第{{ video.episode }}集</span>
      <span class="vcard-play">▶</span>
      <div v-if="showProgress && video.progress > 0 && video.duration > 0" class="vcard-progress">
        <span class="vcard-progress-bar" :style="{ width: Math.min(100, (video.progress / video.duration) * 100) + '%' }"></span>
      </div>
    </div>
    <div class="vcard-body">
      <h3 class="vcard-title">{{ video.title }}</h3>
      <div class="vcard-meta">
        <span class="vcard-author">{{ video.author?.nickname || video.author?.name || '匿名' }}</span>
        <span class="vcard-views">{{ formatCount(video.views) }} 播放</span>
      </div>
    </div>
  </router-link>
</template>

<style scoped>
.vcard {
  display: block;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.28s, border-color 0.28s, background-color 0.3s ease, color 0.3s ease;
  cursor: pointer;
}
.vcard:hover {
  transform: translateY(-6px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-card-lg), 0 0 0 1px var(--border-strong);
}

.vcard-cover {
  position: relative;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: var(--surface-2);
}
.vcard-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), filter 0.3s;
}
.vcard:hover .vcard-cover img { transform: scale(1.06); filter: brightness(1.08); }

.vcard-duration {
  position: absolute;
  right: 8px;
  bottom: 8px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-family: var(--font-syne);
  font-size: 12px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 6px;
  letter-spacing: 0.04em;
}

.vcard-episode {
  position: absolute;
  left: 8px;
  top: 8px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
  letter-spacing: 0.04em;
}

.vcard-play {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 44px;
  color: #fff;
  opacity: 0;
  transform: scale(0.7);
  transition: all 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
  text-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
  background: radial-gradient(circle, rgba(0,0,0,0.25), transparent 70%);
}
.vcard:hover .vcard-play { opacity: 1; transform: scale(1); }

.vcard-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.18);
}
.vcard-progress-bar {
  display: block;
  height: 100%;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent);
}

.vcard-body { padding: 12px 14px 14px; }
.vcard-title {
  font-size: 15px;
  font-weight: 700;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.9em;
  transition: color 0.2s;
}
.vcard:hover .vcard-title { color: var(--accent-strong); }
.vcard-meta {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.vcard-author {
  font-size: 13px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vcard-views {
  font-family: var(--font-syne);
  font-size: 12px;
  color: var(--text-faint);
  flex-shrink: 0;
}
</style>
