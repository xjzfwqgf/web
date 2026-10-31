<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import DanmakuLayer from './DanmakuLayer.vue'
import { formatDuration } from '../api'

const props = defineProps({
  src: { type: String, required: true },
  poster: { type: String, default: '' },
  danmaku: { type: Array, default: () => [] },
  startTime: { type: Number, default: 0 }, // 地址栏 ?t= 指定的续播位置（秒）
  watermark: { type: String, default: '' }, // 防录屏动态水印文案（登录昵称 / 游客）
})
const emit = defineEmits(['send-danmaku', 'history'])

const videoRef = ref(null)
const wrapRef = ref(null)
const rateWrapRef = ref(null)

// 倍速：菜单里的常规倍速 + 长按右方向键时的临时加速
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]
const BOOST_RATE = 3

const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(1)
const muted = ref(false)
const buffered = ref(0)
const danmakuEnabled = ref(true)
const showControls = ref(true)
const fullscreen = ref(false)
const showDanmakuInput = ref(false)
const playbackRate = ref(1)
const boosting = ref(false) // 长按右方向键临时加速中
const showRateMenu = ref(false)

const danmakuText = ref('')
const danmakuColor = ref('#ffffff')
const danmakuPos = ref(0)
const colors = ['#ffffff', '#ffe066', '#7ee7ff', '#ff7eb3', '#a5ff90', '#ff9b3d']

let hideTimer = null
let controlsActive = false

// 长按右方向键：按下先起一个计时器，超过 HOLD_MS 才进入加速；
// 在此之前松手就算短按，走原来的「快进 5 秒」
const HOLD_MS = 320
let rightKeyActive = false
let rightHoldTimer = null

const curTime = computed(() => formatDuration(currentTime.value))
const totalTime = computed(() => formatDuration(duration.value))
const progressPct = computed(() => (duration.value ? (currentTime.value / duration.value) * 100 : 0))
const bufferedPct = computed(() => (duration.value ? (buffered.value / duration.value) * 100 : 0))
const rateLabel = computed(() => (playbackRate.value === 1 ? '倍速' : `${playbackRate.value}x`))

// playbackRate 有两个来源：菜单选的常规倍速、长按右键的临时加速。
// 加速优先级更高，松手后回落到用户选的常规倍速。
function applyRate() {
  if (!videoRef.value) return
  videoRef.value.playbackRate = boosting.value ? BOOST_RATE : playbackRate.value
}
function setRate(r) {
  playbackRate.value = r
  showRateMenu.value = false
  applyRate()
  pokeControls()
}
function startBoost() {
  // 暂停时长按不加速，交给松手时的快进来处理，手感更符合预期
  if (!videoRef.value || videoRef.value.paused) return
  boosting.value = true
  applyRate()
  pokeControls()
}
function stopBoost() {
  if (!boosting.value) return
  boosting.value = false
  applyRate()
}
watch([playbackRate, boosting], applyRate)

function togglePlay() {
  if (videoRef.value.paused) videoRef.value.play()
  else videoRef.value.pause()
}
function onTimeupdate() {
  // timeupdate 偶尔在元素重挂载/卸载间隙触发，此时 ref 可能已清空，跳过即可
  if (!videoRef.value) return
  currentTime.value = videoRef.value.currentTime
  emit('history', currentTime.value)
  if (videoRef.value.buffered.length) {
    buffered.value = videoRef.value.buffered.end(videoRef.value.buffered.length - 1)
  }
}
function onPause() { playing.value = false }
function onPlay() { playing.value = true }

let seekDragging = false
function seekToClient(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  if (duration.value) {
    videoRef.value.currentTime = ratio * duration.value
    currentTime.value = videoRef.value.currentTime
  }
}
function onSeekDown(e) {
  seekDragging = true
  if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId)
  seekToClient(e)
  e.preventDefault()
}
function onSeekMove(e) {
  if (seekDragging) seekToClient(e)
}
function onSeekEnd() {
  seekDragging = false
}
function toggleMute() {
  muted.value = !muted.value
  videoRef.value.muted = muted.value
}
function onVolume(v) {
  volume.value = v
  videoRef.value.volume = v
  muted.value = v === 0
  videoRef.value.muted = muted.value
}

async function toggleFullscreen() {
  if (!document.fullscreenElement) {
    await wrapRef.value.requestFullscreen()
  } else {
    await document.exitFullscreen()
  }
}
function onFsChange() {
  fullscreen.value = !!document.fullscreenElement
  nextTick()
}

function pokeControls() {
  showControls.value = true
  controlsActive = true
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    // 倍速菜单开着时不收起控制条，否则菜单会跟着一起淡出点不到
    if (playing.value && !controlsActive && !showRateMenu.value) {
      showControls.value = false
    }
  }, 2600)
}

// 键盘快捷键。重点是空格 = 播放/暂停：
// 之前按空格会切全屏，是因为控制条按钮在点击后保持焦点，
// 浏览器的「空格激活焦点按钮」默认行为把空格转成了再点一次全屏按钮。
function onKeydown(e) {
  // 在输入框/弹幕输入/文本域里按空格应正常输入，不拦截
  const t = e.target
  if (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement ||
    (t && t.isContentEditable)
  ) {
    return
  }
  if (e.code === 'Space') {
    e.preventDefault()
    // 若焦点落在某个控制按钮上，先让它失焦，避免后续空格再次激活它
    if (t instanceof HTMLElement) t.blur()
    togglePlay()
  } else if (e.code === 'ArrowRight') {
    e.preventDefault()
    // 长按会连续触发 keydown（e.repeat），只认第一次
    if (e.repeat || rightKeyActive) return
    rightKeyActive = true
    clearTimeout(rightHoldTimer)
    rightHoldTimer = setTimeout(() => {
      if (rightKeyActive) startBoost()
    }, HOLD_MS)
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault()
    seekBy(-5)
  } else if (e.code === 'KeyF') {
    e.preventDefault()
    toggleFullscreen()
  } else if (e.code === 'KeyM') {
    e.preventDefault()
    toggleMute()
  } else if (e.code === 'Escape') {
    showRateMenu.value = false
  }
}

// 短按右方向键 = 快进 5 秒；长按已在 keydown 里进入加速，松手恢复到常规倍速
function onKeyup(e) {
  if (e.code !== 'ArrowRight') return
  if (!rightKeyActive) return // 输入框里的右键不归我们管
  rightKeyActive = false
  clearTimeout(rightHoldTimer)
  if (boosting.value) stopBoost()
  else seekBy(5)
}

// 切窗口/失焦时收不到 keyup，兜底退出加速，免得卡在 3x
function onWindowBlur() {
  if (!rightKeyActive) return
  rightKeyActive = false
  clearTimeout(rightHoldTimer)
  stopBoost()
}
function seekBy(delta) {
  if (!duration.value || !videoRef.value) return
  const next = Math.min(duration.value, Math.max(0, currentTime.value + delta))
  videoRef.value.currentTime = next
  currentTime.value = next
  pokeControls()
}
function onMouseMove() {
  pokeControls()
  controlsActive = true
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => { controlsActive = false }, 200)
}

function sendDanmaku() {
  const text = danmakuText.value.trim()
  if (!text) return
  emit('send-danmaku', {
    time: currentTime.value,
    text,
    color: danmakuColor.value,
    position: danmakuPos.value,
  })
  danmakuText.value = ''
  showDanmakuInput.value = false
}

function toggleDanmakuInput() {
  showDanmakuInput.value = !showDanmakuInput.value
  if (showDanmakuInput.value) nextTick(() => document.getElementById('dm-input')?.focus())
}

watch(
  () => props.src,
  () => {
    playing.value = false
    currentTime.value = 0
    duration.value = 0
  },
)
function onLoaded() {
  duration.value = videoRef.value.duration || 0
  // 换 src 重新加载后浏览器会把 playbackRate 重置回 1，这里补回用户选的倍速
  applyRate()
  // 地址栏 ?t= 续播：元数据就绪后 seek 过去
  if (props.startTime > 0 && duration.value > 0) {
    const target = Math.min(props.startTime, Math.max(0, duration.value - 1))
    try {
      videoRef.value.currentTime = target
      currentTime.value = target
    } catch {}
  }
}

function onDocPointerDown(e) {
  if (showRateMenu.value && rateWrapRef.value && !rateWrapRef.value.contains(e.target)) {
    showRateMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('fullscreenchange', onFsChange)
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('keyup', onKeyup)
  document.addEventListener('pointerdown', onDocPointerDown)
  window.addEventListener('blur', onWindowBlur)
})
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFsChange)
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('keyup', onKeyup)
  document.removeEventListener('pointerdown', onDocPointerDown)
  window.removeEventListener('blur', onWindowBlur)
  clearTimeout(hideTimer)
  clearTimeout(rightHoldTimer)
})
</script>

<template>
  <div
    ref="wrapRef"
    class="player"
    :class="{ 'is-fullscreen': fullscreen, 'controls-hidden': !showControls }"
    @mousemove="onMouseMove"
    @mouseleave="playing && (showControls = false)"
    @contextmenu.prevent
  >
    <video
      ref="videoRef"
      class="player-video"
      :src="src"
      :poster="poster"
      :muted="muted"
      playsinline
      controlsList="nodownload"
      @play="onPlay"
      @pause="onPause"
      @timeupdate="onTimeupdate"
      @loadedmetadata="onLoaded"
      @click="togglePlay"
      @dragstart.prevent
    ></video>

    <!-- 防录屏动态水印（缓慢漂移防裁切；在弹幕层之下，弹幕仍盖在上面） -->
    <div v-if="watermark" class="wm-layer" aria-hidden="true">
      <span v-for="i in 9" :key="i" class="wm-item">{{ watermark }}</span>
    </div>

    <!-- 长按右方向键的临时加速提示 -->
    <div v-if="boosting" class="rate-boost fade-in" aria-hidden="true">
      <span class="rate-boost-ico">▶▶</span>{{ BOOST_RATE }}x 快进中
    </div>

    <!-- 弹幕层 -->
    <DanmakuLayer
      v-if="danmakuEnabled"
      :list="danmaku"
      :playing="playing"
      :current-time="currentTime"
      :enabled="danmakuEnabled"
    />

    <!-- 弹幕发送输入条 -->
    <div v-if="showDanmakuInput" class="dm-input-bar fade-in">
      <div class="dm-options">
        <button
          v-for="c in colors"
          :key="c"
          class="dm-color"
          :class="{ active: danmakuColor === c }"
          :style="{ background: c }"
          @click="danmakuColor = c"
        ></button>
        <span class="dm-sep"></span>
        <button class="dm-pos" :class="{ active: danmakuPos === 0 }" @click="danmakuPos = 0">滚动</button>
        <button class="dm-pos" :class="{ active: danmakuPos === 1 }" @click="danmakuPos = 1">顶部</button>
        <button class="dm-pos" :class="{ active: danmakuPos === 2 }" @click="danmakuPos = 2">底部</button>
      </div>
      <input
        id="dm-input"
        v-model="danmakuText"
        class="dm-input"
        placeholder="发个弹幕吧…（回车发送）"
        maxlength="100"
        @keyup.enter="sendDanmaku"
      />
      <button class="btn btn-primary dm-send" @click="sendDanmaku">发送</button>
    </div>

    <!-- 播放按钮（暂停时） -->
    <button v-if="!playing" class="player-play-btn" @click="togglePlay">
      <span>▶</span>
    </button>

    <!-- 控制条 -->
    <div class="controls" :class="{ visible: showControls }">
      <div class="progress-wrap" @pointerdown="onSeekDown" @pointermove="onSeekMove" @pointerup="onSeekEnd" @pointercancel="onSeekEnd">
        <div class="progress-track">
          <div class="progress-buffer" :style="{ width: bufferedPct + '%' }"></div>
          <div class="progress-played" :style="{ width: progressPct + '%' }"></div>
          <div class="progress-thumb" :style="{ left: progressPct + '%' }"></div>
        </div>
      </div>
      <div class="controls-row">
        <div class="controls-left">
          <button class="ctl-btn" @click="togglePlay">
            <svg v-if="playing" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
            <svg v-else viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M7 5v14l12-7z"/></svg>
          </button>
          <button class="ctl-btn" @click="toggleMute">
            <svg v-if="muted" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m16 9 5 5M21 9l-5 5"/></svg>
            <svg v-else viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8 8 0 0 1 0 12"/></svg>
          </button>
          <input type="range" class="volume-slider" min="0" max="1" step="0.05" :value="volume" @input="onVolume(+$event.target.value)" />
          <span class="time-text">{{ curTime }} / {{ totalTime }}</span>
        </div>
        <div class="controls-right">
          <button class="ctl-btn" :class="{ active: danmakuEnabled }" title="弹幕开关" @click="danmakuEnabled = !danmakuEnabled">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 4v-4H5a2 2 0 0 1-2-2V6z"/><text x="9.5" y="14" font-size="7" fill="#0b0b0e" font-weight="900">弹</text></svg>
          </button>
          <button class="ctl-btn" :class="{ active: showDanmakuInput }" title="发弹幕" @click="toggleDanmakuInput">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <div ref="rateWrapRef" class="rate-wrap">
            <button
              class="ctl-btn rate-btn"
              :class="{ active: playbackRate !== 1 }"
              :title="`播放速度（长按 → 键可 ${BOOST_RATE}x 快进）`"
              @click="showRateMenu = !showRateMenu"
            >
              <span class="rate-text">{{ rateLabel }}</span>
            </button>
            <div v-if="showRateMenu" class="rate-menu fade-in">
              <button
                v-for="r in RATES"
                :key="r"
                class="rate-item"
                :class="{ active: r === playbackRate }"
                @click="setRate(r)"
              >
                {{ r }}x
              </button>
            </div>
          </div>
          <button class="ctl-btn" @click="toggleFullscreen">
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.player {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: var(--radius);
  overflow: hidden;
  cursor: default;
  box-shadow: var(--shadow-card);
}
.player-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}
.player.is-fullscreen {
  border-radius: 0;
  aspect-ratio: auto;
  height: 100%;
}
.is-fullscreen .player-video { height: 100vh; }

/* 防录屏动态水印：网格排布 + 缓慢漂移，简单裁单帧也无法完全去净 */
.wm-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  align-items: center;
  justify-items: center;
}
.wm-item {
  font-family: var(--font-syne), sans-serif;
  font-size: 14px;
  letter-spacing: 0.2em;
  color: rgba(255, 255, 255, 0.08);
  user-select: none;
  white-space: nowrap;
  transform: rotate(-18deg);
  animation: wm-drift 13s ease-in-out infinite alternate;
  will-change: transform;
}
.wm-item:nth-child(2n) { animation-delay: -6.5s; font-size: 12px; }
.wm-item:nth-child(3n) { animation-delay: -3.2s; }
@keyframes wm-drift {
  from { transform: rotate(-18deg) translate(0, 0); }
  to { transform: rotate(-18deg) translate(16px, -12px); }
}

.player-play-btn {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 84px;
  height: 84px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px);
  color: #fff;
  font-size: 32px;
  display: grid;
  place-items: center;
  padding-left: 6px;
  opacity: 0.92;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.player-play-btn span { text-shadow: 0 4px 18px rgba(0, 0, 0, 0.6); }
.player-play-btn:hover {
  transform: scale(1.1);
  background: var(--accent);
  color: var(--accent-text);
}

.controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 18px 16px 12px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.82), transparent);
  opacity: 0;
  transform: translateY(8px);
  transition: all 0.28s ease;
  pointer-events: none;
}
.controls.visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}
.player:hover .controls, .player.controls-hidden:hover .controls {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.progress-wrap {
  padding: 6px 0;
  cursor: pointer;
  touch-action: none;
}
.progress-track {
  position: relative;
  height: 4px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.2);
}
.progress-buffer {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 4px;
}
.progress-played {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: var(--accent);
  border-radius: 4px;
  box-shadow: 0 0 10px var(--accent-glow);
}
.progress-thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  transform: translate(-50%, -50%);
  opacity: 0;
  transition: opacity 0.2s;
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.5);
}
.progress-wrap:hover .progress-thumb { opacity: 1; }

.controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}
.controls-left, .controls-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ctl-btn {
  border: none;
  background: transparent;
  color: #fff;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  transition: background 0.15s;
}
.ctl-btn:hover { background: rgba(255, 255, 255, 0.12); }
.ctl-btn.active { color: var(--accent); }
/* 倍速按钮 + 上拉菜单 */
.rate-wrap { position: relative; display: flex; }
.rate-btn { width: auto; min-width: 42px; padding: 0 7px; }
.rate-text {
  font-family: var(--font-syne);
  font-size: 13px;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.rate-menu {
  position: absolute;
  bottom: calc(100% + 10px);
  right: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 6px;
  border-radius: 12px;
  background: rgba(10, 10, 13, 0.92);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-pop);
  z-index: 6;
}
.rate-item {
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.85);
  font-family: var(--font-syne);
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 8px;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}
.rate-item:hover { background: rgba(255, 255, 255, 0.12); }
.rate-item.active { background: var(--accent); color: var(--accent-text); font-weight: 700; }

/* 长按右键时的加速提示（不可点击，不挡弹幕输入） */
.rate-boost {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 16px;
  border-radius: 999px;
  background: rgba(10, 10, 13, 0.72);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-pop);
  color: #fff;
  font-family: var(--font-syne);
  font-size: 13px;
  letter-spacing: 0.04em;
  pointer-events: none;
  z-index: 6;
}
.rate-boost-ico { color: var(--accent); letter-spacing: -0.1em; }

.time-text {
  font-family: var(--font-syne);
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  margin-left: 4px;
  letter-spacing: 0.03em;
}
.volume-slider { width: 70px; accent-color: var(--accent); cursor: pointer; }

/* 弹幕输入 */
.dm-input-bar {
  position: absolute;
  bottom: 64px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(10, 10, 13, 0.9);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  padding: 6px 8px 6px 14px;
  width: min(560px, 90%);
  z-index: 5;
  box-shadow: var(--shadow-pop);
}
.dm-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: #fff;
  font-size: 14px;
  outline: none;
}
.dm-send { padding: 7px 16px; flex-shrink: 0; }
.dm-options { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.dm-color {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid transparent;
  transition: transform 0.15s, border-color 0.15s;
}
.dm-color.active { border-color: #fff; transform: scale(1.15); }
.dm-sep { width: 1px; height: 18px; background: var(--border-strong); margin: 0 2px; }
.dm-pos {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 999px;
  transition: all 0.15s;
}
.dm-pos.active { color: var(--accent); background: var(--accent-soft); }
</style>
