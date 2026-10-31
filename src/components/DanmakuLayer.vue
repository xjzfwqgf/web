<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

// 弹幕渲染层：canvas 自绘，支持滚动/顶部/底部三种位置
const props = defineProps({
  list: { type: Array, default: () => [] }, // {id,time,text,color,position}
  playing: { type: Boolean, default: true },
  currentTime: { type: Number, default: 0 },
  speed: { type: Number, default: 1 },
  enabled: { type: Boolean, default: true },
})

const canvasRef = ref(null)
let ctx = null
let rafId = 0
let canvasW = 0
let canvasH = 0
let dpr = 1

const LANE_H = 30
const TOP_PAD = 12
const FIXED_DURATION = 4000 // 顶部/底部停留毫秒
const SCROLL_DURATION = 8000 // 滚动弹幕过屏时长（基准）

let sorted = [] // 按 time 升序
let cursor = 0
let simTime = 0 // 与视频同步的模拟时间
let lastFrame = 0
let items = [] // 活跃弹幕
let lastItems = [] // 每车道最近滚动的弹幕（用于判断能否再进）
let occupiedUntil = [] // 顶部/底部车道占用截止时间
let laneCount = 0

function measure(text) {
  ctx.font = '700 25px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif'
  return ctx.measureText(text).width
}

function ensureLanes() {
  laneCount = Math.max(1, Math.floor((canvasH - TOP_PAD * 2) / LANE_H))
  lastItems = new Array(laneCount).fill(null)
  occupiedUntil = new Array(laneCount).fill(0)
}

function pickScrollLane(w) {
  let best = -1
  let bestVal = Infinity
  for (let i = 0; i < laneCount; i++) {
    const last = lastItems[i]
    // 该车道最近弹幕的右边缘已过左侧 → 可复用
    const val = last ? last.x + last.w : -9999
    if (last && last.x + last.w > canvasW - 30) continue
    if (val < bestVal) {
      bestVal = val
      best = i
    }
  }
  if (best === -1) best = (performance.now() | 0) % laneCount
  return best
}

function pickFixedLane() {
  const now = performance.now()
  for (let i = 0; i < laneCount; i++) {
    if (occupiedUntil[i] <= now) return i
  }
  return (now | 0) % laneCount
}

function spawnPending() {
  while (cursor < sorted.length && sorted[cursor].time <= simTime) {
    if (items.length > 260) break
    const d = sorted[cursor]
    const w = measure(d.text) + 16
    const pos = d.position
    let lane
    if (pos === 0) {
      lane = pickScrollLane(w)
    } else {
      lane = pickFixedLane()
      occupiedUntil[lane] = performance.now() + FIXED_DURATION
    }
    const y = TOP_PAD + lane * LANE_H + 6
    const item = {
      id: d.id,
      text: d.text,
      color: d.color,
      pos,
      w,
      x: pos === 0 ? canvasW + 10 : (canvasW - w) / 2,
      y,
      lane,
      born: performance.now(),
      scrollDuration: SCROLL_DURATION, // 匀速过屏（时长固定，长弹幕移动更快）
      opacity: 0,
    }
    items.push(item)
    if (pos === 0) lastItems[lane] = item
    cursor++
  }
}

function tick(now) {
  const dt = Math.min(50, now - lastFrame)
  lastFrame = now

  // 推进模拟时间（与播放器同步，平滑）
  if (props.playing && props.enabled) {
    simTime += (dt / 1000) * props.speed
    if (simTime > props.currentTime + 1.5) simTime = props.currentTime
  }

  spawnPending()

  // 更新位置
  items = items.filter((it) => {
    const elapsed = now - it.born
    if (it.pos === 0) {
      it.x -= (dt / it.scrollDuration) * (canvasW + it.w)
      it.opacity = Math.min(1, it.opacity + dt / 120)
      return it.x + it.w > -20
    }
    // 顶部/底部停留
    if (elapsed > FIXED_DURATION - 400) {
      it.opacity = Math.max(0, it.opacity - dt / 400)
    } else {
      it.opacity = Math.min(1, it.opacity + dt / 120)
    }
    return elapsed < FIXED_DURATION
  })

  render()
  rafId = requestAnimationFrame(tick)
}

function render() {
  ctx.clearRect(0, 0, canvasW, canvasH)
  ctx.font = '700 25px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif'
  for (const it of items) {
    if (it.opacity <= 0.01) continue
    ctx.globalAlpha = it.opacity
    ctx.fillStyle = it.color
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 6
    ctx.shadowOffsetY = 2
    ctx.fillText(it.text, it.x, it.y + 22)
  }
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
}

function reset() {
  sorted = [...props.list].sort((a, b) => a.time - b.time)
  cursor = 0
  items = []
  simTime = props.currentTime
  lastItems = new Array(laneCount).fill(null)
  occupiedUntil = new Array(laneCount).fill(0)
}

function resize() {
  const canvas = canvasRef.value
  if (!canvas || !canvas.parentElement) return
  const rect = canvas.parentElement.getBoundingClientRect()
  dpr = window.devicePixelRatio || 1
  canvasW = Math.max(320, rect.width)
  canvasH = Math.max(180, rect.height)
  canvas.width = canvasW * dpr
  canvas.height = canvasH * dpr
  canvas.style.width = canvasW + 'px'
  canvas.style.height = canvasH + 'px'
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ensureLanes()
}

watch(() => props.list, reset, { deep: false })
watch(() => props.currentTime, (t) => {
  if (Math.abs(t - simTime) > 2) simTime = t // 拖动进度条时对齐
})
watch(() => props.enabled, (v) => {
  if (v) simTime = props.currentTime
})

let ro = null
onMounted(async () => {
  await nextTick()
  ctx = canvasRef.value.getContext('2d')
  resize()
  ro = new ResizeObserver(resize)
  ro.observe(canvasRef.value.parentElement)
  reset()
  lastFrame = performance.now()
  rafId = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  ro?.disconnect()
})
</script>

<template>
  <canvas ref="canvasRef" class="danmaku-canvas"></canvas>
</template>

<style scoped>
.danmaku-canvas {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>
