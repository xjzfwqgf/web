<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { assetUrl } from '../api'

// 音乐模块已启用登录访问：歌词读写请求需带登录态（Authorization: Bearer）
function authHeaders() {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// 打点式 LRC 歌词编辑器：
// 复用底部 <music-player> 的 audio 做播放，在每句开始时按「空格」把当前时间打到选中行，
// 生成 [mm:ss.xx] 时间轴并保存为同名 .lrc。

const props = defineProps({
  song: { type: Object, required: true },   // { filename, title, artist, ... }
  player: { type: Object, default: null },  // <music-player> 元素（含 .audio）
})
const emit = defineEmits(['close', 'saved'])

// 指向酷狗曲库的歌词端点（GET 读、POST 存，均需登录态）。
// 旧的 /m/api/v1/songs/{filename}/lyrics 只认 musicplayer 的 jays 目录，
// 对 kg/ 下的 hash 文件名无能为力。
// assetUrl：跨域部署时要拼上 VITE_API_BASE（本地开发为空，原样走 vite 代理）。
const LYRIC_URL = assetUrl('/api/music/lyrics/{filename}')

const lines = ref([])          // [{ text, time|null }]
const activeIdx = ref(0)       // 当前选中的行（打点目标）
const curTime = ref(0)
const duration = ref(0)
const playing = ref(false)
const tab = ref('edit')        // 'edit' | 'preview'
const loading = ref(false)
const saving = ref(false)
const saved = ref(false)
const error = ref('')
const pasteOpen = ref(false) // 「粘贴整首」面板是否展开
const pasteText = ref('')    // 面板粘贴区内容
const pasteDragging = ref(false) // 有内容正拖到面板上方（高亮提示）

const lineEls = ref([])        // 行 DOM 元素（滚动定位用）

const audio = computed(() => props.player?.audio || null)
const lyricUrl = computed(() =>
  LYRIC_URL.replace('{filename}', encodeURIComponent(props.song.filename)),
)
const timedCount = computed(() => lines.value.filter((l) => l.time != null).length)
const untimedText = computed(() =>
  lines.value.filter((l) => l.text.trim() && l.time == null).length,
)
const pasteLineCount = computed(() =>
  pasteText.value.trim() ? parseLyricsText(pasteText.value).length : 0,
)

// 正在播放的行：时间轴上「最近的已打点行」
const playIdx = computed(() => {
  let idx = -1
  lines.value.forEach((l, i) => {
    if (l.time != null && l.time <= curTime.value + 0.05) idx = i
  })
  return idx
})

// 生成的 LRC 文本（仅含已打点行，按时间排序）
const previewLrc = computed(() => {
  const meta = [`[ti:${props.song.title || ''}]`, `[ar:${props.song.artist || ''}]`]
  const timed = lines.value
    .filter((l) => l.time != null)
    .slice()
    .sort((a, b) => a.time - b.time)
    .map((l) => `[${fmtStamp(l.time)}]${l.text.trim()}`)
  return [...meta, ...timed].join('\n')
})

/* ---------- 工具 ---------- */

function fmtDur(sec) {
  if (!sec || !isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s < 10 ? '0' : ''}${s}`
}
function fmtStamp(t) {
  if (t == null || !isFinite(t)) return '—:—'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  let cs = Math.round((t - Math.floor(t)) * 100) // 四舍五入，避免浮点 12.34 → .33
  if (cs >= 100) cs = 99
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}
function blurActive() {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur()
}

/* ---------- 播放控制 ---------- */

function playPause() {
  const a = audio.value
  if (!a) return
  if (a.paused) a.play().catch(() => {})
  else a.pause()
}
function seekBy(d) {
  const a = audio.value
  if (!a || !isFinite(a.duration)) return
  a.currentTime = Math.min(Math.max(a.currentTime + d, 0), a.duration)
}
function seekTo(v) {
  const a = audio.value
  if (!a || !isFinite(a.duration)) return
  a.currentTime = Number(v)
}

/* ---------- 歌词行操作 ---------- */

// 核心动作：把当前播放时间打到选中行，并自动跳到下一句
function stamp() {
  const a = audio.value
  if (!a || !lines.value.length) return
  lines.value[activeIdx.value].time = Math.max(0, a.currentTime)
  const next = lines.value.findIndex((l, i) => i > activeIdx.value && l.text.trim())
  if (next >= 0) activeIdx.value = next
  else if (activeIdx.value < lines.value.length - 1) activeIdx.value++
  blurActive()
}
function selectLine(i, e) {
  activeIdx.value = i
  const onInput = e && e.target && e.target.tagName === 'INPUT'
  if (!onInput) {
    blurActive()
    // 点击已打点行 → 把音频跳到该句时间（便于校对/微调）
    const l = lines.value[i]
    const a = audio.value
    if (l && l.time != null && a && isFinite(a.duration)) {
      a.currentTime = Math.min(Math.max(l.time, 0), a.duration)
    }
  }
}
function addLine() {
  lines.value.push({ text: '', time: null })
  activeIdx.value = lines.value.length - 1
  requestAnimationFrame(() => {
    const el = lineEls.value[lines.value.length - 1]
    if (el) el.querySelector('input')?.focus()
  })
}
function removeLine(i) {
  if (lines.value.length <= 1) {
    lines.value = [{ text: '', time: null }]
  } else {
    lines.value.splice(i, 1)
  }
  if (activeIdx.value >= lines.value.length) activeIdx.value = lines.value.length - 1
}
function moveLine(i, dir) {
  const j = i + dir
  if (j < 0 || j >= lines.value.length) return
  const tmp = lines.value[i]
  lines.value[i] = lines.value[j]
  lines.value[j] = tmp
  activeIdx.value = j
}
function clearTimes() {
  lines.value.forEach((l) => (l.time = null))
  error.value = ''
}
/* ---------- 歌词文本解析 ---------- */

// 解析一行里的单个 [mm:ss.xx] 时间戳 → 秒（兼容 .5/.12/.123 三档小数位）
function parseStamp(m) {
  const mm = Number(m[1]) || 0
  const ss = Number(m[2]) || 0
  let frac = 0
  if (m[3]) {
    const fr = Number(m[3])
    const digits = m[3].length
    frac = digits === 1 ? fr / 10 : digits === 2 ? fr / 100 : fr / 1000
  }
  return mm * 60 + ss + frac
}

// 把「整首」粘贴文本解析成歌词行数组。自动：按行拆分、跳过空行与 [ti:]/[ar:] 等元信息、
// 识别行首 [mm:ss.xx] 时间戳（[00:12.34]歌词 → 带 time；一行多个时间戳拆成多行）。
const STAMP_RE = /\[(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?\]/g
const META_RE = /^\s*\[(ti|ar|al|by|offset|re|ver|au)\s*:/i
function parseLyricsText(text) {
  const out = []
  const raw = String(text || '').split(/\r?\n/)
  for (const line of raw) {
    const s = line.trim()
    if (!s) continue
    const stamps = []
    let m
    STAMP_RE.lastIndex = 0
    while ((m = STAMP_RE.exec(s))) stamps.push(parseStamp(m))
    const body = s.replace(STAMP_RE, '').trim()
    if (!stamps.length) {
      if (META_RE.test(s)) continue // 纯元信息行丢弃
      out.push({ text: body || s, time: null })
    } else {
      const content = body || s
      for (const t of stamps) out.push({ text: content, time: t })
    }
  }
  return out
}

/* ---------- 「粘贴整首」面板 ---------- */

function openPasteBox() {
  pasteOpen.value = true
  pasteText.value = ''
  requestAnimationFrame(() => document.querySelector('.lyr-paste-area')?.focus())
}
function closePasteBox() {
  pasteOpen.value = false
  pasteText.value = ''
  blurActive()
}
async function fillFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    if (!text.trim()) return ElMessage.warning('剪贴板里没有文本')
    pasteText.value = text
    ElMessage.success('已读入剪贴板，确认导入即可')
  } catch {
    ElMessage.error('无法读取剪贴板，请直接粘贴到上方输入框')
  }
}

// 把拖入的 .lrc/.txt 歌词文件或选中的整段文字读进粘贴区
function onDropText(e) {
  e.preventDefault()
  pasteDragging.value = false
  const dt = e.dataTransfer
  if (!dt) { pasteText.value = ''; return }
  const file = dt.files && dt.files[0]
  if (file && (file.name.endsWith('.lrc') || file.name.endsWith('.txt') || /text\//.test(file.type))) {
    file.text()
      .then((t) => {
        if (!t.trim()) return ElMessage.warning('文件里没有内容')
        pasteText.value = t
        ElMessage.success(`已读取 ${file.name}`)
      })
      .catch(() => ElMessage.error('无法读取该文件'))
    return
  }
  const text = dt.getData('text') || ''
  if (text.trim()) {
    pasteText.value = text
    ElMessage.success('已导入拖入的歌词文本')
  }
}
function applyPaste() {
  const parsed = parseLyricsText(pasteText.value)
  if (!parsed.length) {
    ElMessage.warning('没有可导入的内容')
    return
  }
  lines.value = parsed
  activeIdx.value = 0
  const timed = parsed.filter((l) => l.time != null).length
  pasteOpen.value = false
  pasteText.value = ''
  error.value = ''
  blurActive()
  ElMessage.success(
    timed
      ? `已导入 ${parsed.length} 行，其中 ${timed} 行带时间戳`
      : `已导入 ${parsed.length} 行，播放后在每句开头按「空格」打点`,
  )
}

/* ---------- 保存 ---------- */

async function save() {
  if (saved.value) return
  const timed = lines.value.filter((l) => l.time != null)
  if (!timed.length) {
    error.value = '还没有打点任何一行：先点「播放」，在每句开始时按空格（或点打点按钮）记录时间。'
    return
  }
  if (untimedText.value) ElMessage.warning(`${untimedText.value} 行没有打点，保存时将被忽略`)
  saving.value = true
  error.value = ''
  try {
    const res = await fetch(lyricUrl.value, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ lrc: previewLrc.value }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json || json.code !== 0) {
      throw new Error((json && json.message) || `保存失败 (${res.status})`)
    }
    saved.value = true
    emit('saved', props.song.filename)
    ElMessage.success(`歌词已保存：${json.data.filename}`)
  } catch (e) {
    error.value = e.message
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

/* ---------- 事件 ---------- */

function onTime() {
  const a = audio.value
  if (a) curTime.value = a.currentTime || 0
}
function onPlay() { playing.value = true }
function onPause() { playing.value = false }
function onEnd() { playing.value = false }
function onDur() {
  const a = audio.value
  if (a) duration.value = a.duration || 0
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    if (pasteOpen.value) { closePasteBox(); return }
    emit('close')
    return
  }
  const tag = e.target && e.target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    // 输入框内：Enter 跳到下一句
    if (e.key === 'Enter' && tag === 'INPUT') {
      e.preventDefault()
      const idx = Number(e.target.dataset.idx)
      if (!Number.isNaN(idx)) {
        const next = lines.value.findIndex((l, i) => i > idx && l.text.trim())
        const target = lineEls.value[next >= 0 ? next : Math.min(idx + 1, lines.value.length - 1)]
        target?.querySelector('input')?.focus()
      }
    }
    return
  }
  if (tag === 'BUTTON') return // 交给按钮自身行为（如打点按钮聚焦后按空格=再打一次）
  if (e.key === ' ') {
    e.preventDefault()
    stamp()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (activeIdx.value > 0) { activeIdx.value--; blurActive() }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (activeIdx.value < lines.value.length - 1) { activeIdx.value++; blurActive() }
  } else if (e.key === 'p' || e.key === 'P') {
    e.preventDefault()
    playPause()
  }
}

async function loadExisting() {
  loading.value = true
  try {
    const res = await fetch(lyricUrl.value, { headers: authHeaders() })
    const json = await res.json()
    const list = (json && json.data && json.data.lyrics) || []
    lines.value = list.length
      ? list.map((l) => ({ text: l.text, time: l.time }))
      : [{ text: '', time: null }]
  } catch {
    lines.value = [{ text: '', time: null }]
  } finally {
    loading.value = false
  }
}

function setLineEl(i, el) {
  if (el) lineEls.value[i] = el
}

onMounted(async () => {
  const a = audio.value
  if (a) {
    duration.value = a.duration || props.song.duration || 0
    curTime.value = a.currentTime || 0
    playing.value = !a.paused
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    a.addEventListener('ended', onEnd)
    a.addEventListener('durationchange', onDur)
  }
  if (props.song.hasLyrics) await loadExisting()
  else lines.value = [{ text: '', time: null }]
  blurActive() // 去掉残留焦点（如迷你播放器按钮），保证空格=打点
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  const a = audio.value
  if (a) {
    a.removeEventListener('timeupdate', onTime)
    a.removeEventListener('play', onPlay)
    a.removeEventListener('pause', onPause)
    a.removeEventListener('ended', onEnd)
    a.removeEventListener('durationchange', onDur)
  }
  window.removeEventListener('keydown', onKeydown)
})

// 播放行跟随滚动
watch(playIdx, (i) => {
  if (i < 0) return
  const el = lineEls.value[i]
  if (el) el.scrollIntoView({ block: 'nearest' })
})
</script>

<template>
  <div class="lyr-overlay" @click.self="$emit('close')">
    <div class="lyr-card">
      <header class="lyr-head">
        <div class="lyr-title">
          <h3>制作歌词</h3>
          <p class="lyr-song">
            <span class="t">{{ song.title }}</span>
            <span v-if="song.artist" class="a">{{ song.artist }}</span>
          </p>
        </div>
        <button class="lyr-close" title="关闭 (Esc)" @click="$emit('close')">✕</button>
      </header>

      <!-- 传输控制 -->
      <div class="lyr-transport">
        <button class="lyr-play" :title="playing ? '暂停 (P)' : '播放 (P)'" @click="playPause">
          <svg v-if="playing" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        </button>
        <button class="lyr-nudge" title="后退 5 秒" @click="seekBy(-5)">−5s</button>
        <input
          class="lyr-seek"
          type="range"
          :min="0"
          :max="duration || 0"
          :step="0.1"
          :value="curTime"
          :disabled="!duration"
          @input="seekTo($event.target.value)"
        />
        <button class="lyr-nudge" title="前进 5 秒" @click="seekBy(5)">+5s</button>
        <span class="lyr-time">{{ fmtDur(curTime) }} / {{ fmtDur(duration) }}</span>
      </div>

      <!-- 打点主按钮 + 快捷键提示 -->
      <div class="lyr-toolbar">
        <button class="lyr-stamp" @click="stamp">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19v-6" /><path d="M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" /><circle cx="12" cy="13" r="8" /></svg>
          打点到当前行
          <kbd>空格</kbd>
        </button>
        <div class="lyr-hint">空格=打点 · P=播放/暂停 · ↑↓=选行 · Esc=关闭</div>
        <div class="lyr-count">已打点 {{ timedCount }} / {{ lines.length }}</div>
      </div>

      <!-- 编辑 / 预览 切换 -->
      <div class="lyr-tabs">
        <button :class="{ on: tab === 'edit' }" @click="tab = 'edit'">歌词行</button>
        <button :class="{ on: tab === 'preview' }" @click="tab = 'preview'">LRC 预览</button>
      </div>

      <!-- 编辑区：粘贴整首 / 歌词行列表 -->
      <div v-if="tab === 'edit'">
        <!-- 粘贴整首面板 -->
        <div
          v-if="pasteOpen"
          class="lyr-paste"
          :class="{ drop: pasteDragging }"
          @dragover.prevent="pasteDragging = true"
          @dragleave.prevent="pasteDragging = false"
          @drop.prevent="onDropText"
        >
          <textarea
            v-model="pasteText"
            class="lyr-paste-area"
            spellcheck="false"
            placeholder="在此粘贴整首歌词：每行一句。&#10;含 [00:12.34] 时间戳的会自动打点；纯文本则导入后按「空格」逐句打点。"
          ></textarea>
          <div class="lyr-paste-foot">
            <div class="lyr-paste-hint">
              <button class="lyr-link" @click="fillFromClipboard">从剪贴板读取</button>
              <span>Ctrl+V 粘贴 · 或把 .lrc/.txt 歌词文件 / 选中文字拖到这里</span>
            </div>
            <div class="lyr-paste-btns">
              <button class="lyr-btn ghost" @click="closePasteBox">取消</button>
              <button class="lyr-btn primary" :disabled="!pasteLineCount" @click="applyPaste">
                导入{{ pasteLineCount ? ` ${pasteLineCount} 行` : '' }}
              </button>
            </div>
          </div>
        </div>

        <!-- 歌词行列表 -->
        <div v-else class="lyr-lines">
          <div v-if="loading" class="lyr-empty">正在读取已有歌词…</div>
          <div
            v-for="(l, i) in lines"
            :key="i"
            class="lyr-line"
            :class="{ active: i === activeIdx, playing: i === playIdx }"
            :ref="(el) => setLineEl(i, el)"
            @click="selectLine(i, $event)"
          >
            <span class="col-no">{{ i + 1 }}</span>
            <span class="col-time" :class="{ on: l.time != null }" :title="l.time != null ? '点击跳到该句时间' : ''">
              {{ l.time != null ? fmtStamp(l.time) : '—:—' }}
            </span>
            <input
              class="col-text"
              :data-idx="i"
              v-model="l.text"
              :placeholder="`第 ${i + 1} 句歌词…`"
              spellcheck="false"
            />
            <button class="col-del" title="删除此行" @click.stop="removeLine(i)">✕</button>
          </div>
          <div v-if="!lines.length && !loading" class="lyr-empty">暂无歌词行，点「粘贴整首」或「＋ 添加行」开始</div>
        </div>
      </div>

      <!-- LRC 预览 -->
      <pre v-else class="lyr-preview">{{ previewLrc }}</pre>

      <!-- 底部操作 -->
      <div class="lyr-foot">
        <div class="lyr-msg" :class="{ err: error }">
          {{ error || (saved ? '已保存 ✓ 播放器会自动刷新歌词' : '') }}
        </div>
        <div class="lyr-actions">
          <button class="lyr-btn ghost" @click="openPasteBox">粘贴整首</button>
          <button class="lyr-btn ghost" @click="addLine">＋ 添加行</button>
          <button class="lyr-btn ghost danger" @click="clearTimes">清空打点</button>
          <button class="lyr-btn ghost" @click="$emit('close')">取消</button>
          <button class="lyr-btn primary" :disabled="saving || saved" @click="save">
            {{ saving ? '保存中…' : saved ? '已保存 ✓' : '保存歌词' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lyr-overlay {
  position: fixed;
  inset: 0;
  z-index: 20000;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.lyr-card {
  width: min(860px, 96vw);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
}

/* ---------- 头部 ---------- */
.lyr-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px 14px;
}
.lyr-title h3 {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.lyr-song {
  margin-top: 4px;
  font-size: 13px;
  color: var(--text-dim);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lyr-song .t { color: var(--text); font-weight: 600; }
.lyr-song .a { margin-left: 8px; }
.lyr-close {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--text-dim);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.lyr-close:hover { background: var(--surface-3); color: var(--text); }

/* ---------- 传输控制 ---------- */
.lyr-transport {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 22px;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}
.lyr-play {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border: none;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-text);
  display: grid;
  place-items: center;
  cursor: pointer;
  box-shadow: 0 6px 18px var(--accent-glow);
  transition: transform 0.15s, background 0.15s;
}
.lyr-play svg { width: 18px; height: 18px; }
.lyr-play:hover { background: var(--accent-hover); transform: scale(1.05); }
.lyr-nudge {
  flex-shrink: 0;
  padding: 7px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.lyr-nudge:hover { border-color: var(--accent); color: var(--accent); }
.lyr-seek {
  flex: 1;
  min-width: 60px;
  height: 4px;
  accent-color: var(--accent);
  cursor: pointer;
}
.lyr-time {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ---------- 打点工具栏 ---------- */
.lyr-toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 22px;
}
.lyr-stamp {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 18px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--accent-text);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 8px 22px var(--accent-glow);
  transition: transform 0.15s, background 0.15s, box-shadow 0.15s;
}
.lyr-stamp svg { width: 17px; height: 17px; }
.lyr-stamp:hover { background: var(--accent-hover); transform: translateY(-1px); }
.lyr-stamp:active { transform: translateY(0); }
.lyr-stamp kbd {
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.22);
  font-size: 11px;
  font-weight: 600;
}
.lyr-hint {
  flex: 1;
  font-size: 12px;
  color: var(--text-faint);
}
.lyr-count {
  font-size: 12px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ---------- 标签页 ---------- */
.lyr-tabs {
  display: flex;
  gap: 6px;
  padding: 0 22px 10px;
}
.lyr-tabs button {
  padding: 6px 14px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.lyr-tabs button:hover { background: var(--surface-2); }
.lyr-tabs button.on {
  background: var(--accent-soft);
  color: var(--accent);
}

/* ---------- 粘贴整首面板 ---------- */
.lyr-paste {
  flex: 1;
  min-height: 220px;
  max-height: 40vh;
  display: flex;
  flex-direction: column;
  padding: 12px;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.lyr-paste-area {
  flex: 1;
  min-height: 160px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.8;
  resize: none;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.lyr-paste-area:focus {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}
.lyr-paste.drop {
  outline: 2px dashed var(--accent);
  outline-offset: -6px;
  border-radius: var(--radius-sm);
}
.lyr-paste.drop .lyr-paste-area { border-color: var(--accent); }
.lyr-paste-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 10px;
}
.lyr-paste-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-faint);
  min-width: 0;
}
.lyr-link {
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  white-space: nowrap;
}
.lyr-link:hover { text-decoration: underline; }
.lyr-paste-btns {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* ---------- 歌词行列表 ---------- */
.lyr-lines {
  flex: 1;
  min-height: 220px;
  max-height: 40vh;
  overflow-y: auto;
  padding: 6px;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.lyr-empty {
  padding: 40px 0;
  text-align: center;
  color: var(--text-faint);
  font-size: 13px;
}
.lyr-line {
  display: grid;
  grid-template-columns: 24px 74px minmax(0, 1fr) 22px;
  gap: 8px;
  align-items: center;
  padding: 5px 8px;
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: background 0.15s;
}
.lyr-line:hover { background: var(--surface-2); }
.lyr-line.playing { background: var(--accent-soft); }
.lyr-line.playing .col-text { color: var(--accent); }
.lyr-line.active { box-shadow: inset 0 0 0 1.5px var(--accent); background: var(--accent-soft); }
.col-no {
  text-align: right;
  font-size: 11px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.col-time {
  text-align: right;
  font-size: 12px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.col-time.on { color: var(--accent); font-weight: 700; }
.col-text {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  outline: none;
  transition: all 0.15s;
}
.col-text:hover { background: var(--surface-2); }
.col-text:focus { background: var(--surface-2); border-color: var(--accent); }
.col-del {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-faint);
  font-size: 11px;
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s;
}
.lyr-line:hover .col-del { opacity: 1; }
.col-del:hover { background: var(--rose-soft); color: var(--accent-rose); }

/* ---------- LRC 预览 ---------- */
.lyr-preview {
  flex: 1;
  min-height: 220px;
  max-height: 40vh;
  margin: 0;
  padding: 16px 20px;
  overflow: auto;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.9;
  white-space: pre;
}

/* ---------- 底部 ---------- */
.lyr-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 22px;
}
.lyr-msg {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lyr-msg.err { color: var(--accent-rose); white-space: normal; }
.lyr-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.lyr-btn {
  padding: 8px 14px;
  border-radius: var(--radius-xs);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.lyr-btn.ghost {
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text);
}
.lyr-btn.ghost:hover { border-color: var(--accent); color: var(--accent); }
.lyr-btn.ghost.danger:hover { border-color: var(--accent-rose); color: var(--accent-rose); }
.lyr-btn.primary {
  border: none;
  background: var(--accent);
  color: var(--accent-text);
  box-shadow: 0 6px 18px var(--accent-glow);
}
.lyr-btn.primary:hover { background: var(--accent-hover); }
.lyr-btn.primary:disabled { opacity: 0.6; cursor: default; }

@media (max-width: 640px) {
  .lyr-hint { display: none; }
  .lyr-foot { flex-direction: column; align-items: stretch; }
  .lyr-actions { flex-wrap: wrap; justify-content: flex-end; }
  .lyr-msg { order: 1; }
}
</style>
