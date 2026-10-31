<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { assetUrl, parseServerTime } from '../api'
import { useUserStore } from '../stores/user'
import { revealFrom } from '../lib/gsap'

// 音乐模块 · 网易云风格页面。
//
// 布局：左侧固定侧边栏 + 中间可滚动主区 + 底部固定播放条（三段，占满视口）。
// 播放能力仍来自 yc-musicplayer 的 <music-player>，但它被**视觉隐藏**、退化为纯音频引擎 ——
// 原因见下方 music-player 标签处的注释。
//
// 曲库来自**酷狗「我喜欢」**（后端 /api/music），组件脚本仍从 /m/dist 加载。

// ?v= 缓存破除：组件脚本直接改 dist、无构建步骤，加版本号避免浏览器沿用旧的已缓存副本
// （线上不再依赖仓库根那个已丢失的 musicplayer/，改由 web/public/m/dist/musicplayer.js 提供；
//   v 从 20260906-a 提到 20261031-a，是为了让浏览器丢掉可能缓存过的旧组件/404）
const MP_SCRIPT = '/m/dist/musicplayer.js?v=20261031-a'
// 这些是**后端**路径，不是本站路径：线上前后端不同域，必须拼上 VITE_API_BASE
// （本地开发 VITE_API_BASE 为空，assetUrl 原样返回，仍然走 vite 代理）
const PLAYLIST_URL = assetUrl('/api/music/tracks')
const META_URL = assetUrl('/api/music/meta')
const STATUS_URL = assetUrl('/api/music/status')
const KUGOU = assetUrl('/api/music/kugou')
const DL = assetUrl('/api/music/download')
const LYRICS_URL = assetUrl('/api/music/lyrics')
// 传给 <music-player> 的属性值（本页不依赖它去拉数据，但跨域部署下同样要带上 API 基址）
const STREAM_TMPL = assetUrl('/api/music/stream/{filename}')
const LYRIC_TMPL = assetUrl('/api/music/lyrics/{filename}')
const COVER_TMPL = assetUrl('/api/music/cover/{filename}')

// 线上部署（Vercel Serverless）没有持久磁盘，也没有长驻进程跑批量下载，
// 所以「下载全部 / 取消下载」在后端已降级为 no-op：点了没反应，而进度轮询还会在
// 连续失败后弹「后端无响应」。这里整体关掉，界面上只留一句说明。
const DOWNLOAD_ENABLED = false

// 音乐模块已启用登录访问：数据请求需带登录态
function authHeaders() {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const scriptState = ref('loading') // 'loading' | 'ready' | 'error'
const allSongs = ref([]) // **可播**的曲目，驱动播放器
// 不可播的曲目（未绑定酷狗且本地没缓存 / 酷狗判定受限）。
// 刻意**不放进 allSongs**：currentIdx / playAt(x.di) 都假设「展示数组下标 === 播放器下标」，
// 混进不可播的会让点任意一首都播错歌。
const lockedSongs = ref([])
const order = ref([]) // 展示顺序（allSongs 下标数组），随机播放时重排
const currentIdx = ref(-1) // 组件内的当前歌曲下标（相对展示顺序）
const isPlaying = ref(false)
const loading = ref(false)
const search = ref('')
const meta = ref(null)

// ---- 侧边导航（只保留有数据源的项） ----
// 私人 FM / 排行榜 / 收藏都没有数据源，不做空壳菜单。
const navTab = ref('liked') // 'liked' | 'locked'
const TABS = [
  // 我的歌单 = 酷狗「我喜欢」里可播的那些（就是播放器里那一份）
  { key: 'liked', label: '我的歌单', path: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z' },
  // 未缓存 = 播不了的（未绑定/受限）
  { key: 'locked', label: '未缓存', path: 'M12 1a5 5 0 0 0-5 5v3H5v14h14V9h-2V6a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v3H9V6a3 3 0 0 1 3-3z' },
]

// ---- 播放模式（新逻辑） ----
// 组件本身**没有任何播放模式实现**（nextSong() 就是 (i+1) % len），所以这一整套是本页新写的。
const playMode = ref('list') // 'list' | 'single' | 'shuffle'
const PLAY_MODES = [
  { key: 'list', label: '列表循环' },
  { key: 'single', label: '单曲循环' },
  { key: 'shuffle', label: '随机播放' },
]
const playModeInfo = computed(() => PLAY_MODES.find((m) => m.key === playMode.value))

// ---- 进度 / 音量（自绘） ----
const curTime = ref(0)
const durTime = ref(0)
const seeking = ref(false) // 拖动进度条期间暂停自动刷新，否则填充会被 rAF 拽回去
const volPct = ref(80) // 组件默认 audio.volume = 0.8
const muted = ref(false)

// ---- 全屏播放页（点底部播放条展开） ----
const expanded = ref(false)
const lyrics = ref([]) // [{ time: 秒, text }]，后端 /lyrics 已解析并升序排好
const lyricsFor = ref('') // 已请求过的 filename，避免反复抓同一首
const curLine = ref(-1) // 当前歌词行下标
const glowColor = ref('rgba(255, 255, 255, 0.16)') // 封面色光晕，取不到时用中性白
const lyricBox = ref(null)
/** 全屏页的氛围背景就是封面本身的模糊放大版，所以色调整齐地跟着封面走 */
const expCover = computed(() => {
  const s = currentSong.value
  return s && s.hasCover && s.coverUrl ? s.coverUrl : ''
})

// ---- 酷狗绑定状态 ----
const userStore = useUserStore()
const kg = ref({ bound: false, nickname: '', trackCount: 0, cachedCount: 0, restrictedCount: 0, lastSyncAt: '' })
const syncing = ref(false)
const qr = ref({ open: false, key: '', image: '', status: 0, expired: false })
let qrTimer = null
// 认不出「我喜欢」时后端回 409 + 候选歌单，这里弹选择
const picker = ref({ open: false, candidates: [] })

// ---- 一键下载歌单 ----
// 进度是后端的内存态，本页只是它的一个观察者（刷新页面/换标签页都能接着看）
const dl = ref({ active: false, total: 0, done: 0, failed: 0, cancelled: false, abortReason: '' })
let dlTimer = null
let dlSeenActive = false // 本地是否处于「下载中」的界面状态，用于判断「刚刚结束」
let dlMisses = 0 // 连续查询失败次数，避免后端挂掉时无限轮询

const player = ref(null)
// 「下一首播放」的瞬时反馈：{ [filename]: true/false }，1.6s 后自动复位
const nextMark = ref({})
const nextTimers = {}
let playerEl = null
let bound = false

const displayed = computed(() => order.value.map((i) => allSongs.value[i]))
const matchQ = (song, q) =>
  (song.title || '').toLowerCase().includes(q) ||
  (song.artist || '').toLowerCase().includes(q) ||
  (song.album || '').toLowerCase().includes(q)

/** 「我的歌单」：可播曲目，di 就是播放器下标 */
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = displayed.value.map((song, di) => ({ song, di, locked: false }))
  if (!q) return list
  return list.filter((x) => matchQ(x.song, q))
})
/** 不可播区块共用同一个搜索词，但没有下标语义（点了不进播放器） */
const lockedFiltered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return q ? lockedSongs.value.filter((s) => matchQ(s, q)) : lockedSongs.value
})
/** 当前页签要渲染的列表（统一成 { song, di, locked } 形状） */
const visibleList = computed(() => {
  if (navTab.value === 'locked') {
    return lockedFiltered.value.map((song) => ({ song, di: -1, locked: true }))
  }
  return filtered.value
})

// ---- 头部标题 / 副标题 ----
const pageTitle = computed(() => (navTab.value === 'locked' ? '未缓存' : '我的歌单'))
const emptyText = computed(() =>
  navTab.value === 'locked' ? '没有未缓存的曲目' : '没有可播放的歌曲',
)
const pageSub = computed(() => {
  if (navTab.value === 'locked') {
    return kg.value.bound
      ? '这些曲目在酷狗需要会员或已下架'
      : '绑定酷狗账号后即可在线播放并自动缓存到本地'
  }
  return meta.value ? `共 ${meta.value.songCount} 首 · ${meta.value.formats}` : ''
})

const currentSong = computed(() =>
  currentIdx.value >= 0 ? displayed.value[currentIdx.value] : displayed.value[0] || null,
)

/* ---------- 工具 ---------- */

function fmtDur(sec) {
  if (!sec || !isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

// 依据标题生成稳定渐变（无封面时的占位）
const PALETTES = [
  ['#0071e3', '#5ac8fa'], ['#36d1dc', '#5b86e5'], ['#5856d6', '#af52de'],
  ['#11998e', '#30d158'], ['#0a84ff', '#64d2ff'], ['#7f00ff', '#e100ff'],
  ['#00c6ff', '#0072ff'], ['#0a84ff', '#5856d6'], ['#1c1c1e', '#5856d6'],
  ['#134e5e', '#5b86e5'],
]
function coverGradient(title) {
  let h = 0
  for (const c of String(title || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const p = PALETTES[h % PALETTES.length]
  return `linear-gradient(135deg, ${p[0]}, ${p[1]})`
}

/** 切到固定页签（TABS 里的两项） */
function pickTab(key) {
  navTab.value = key
}

/** 侧边栏每一项右侧的数量 */
function tabCount(key) {
  if (key === 'liked') return allSongs.value.length
  return lockedSongs.value.length
}

/* ---------- 数据加载 ---------- */

async function loadMeta() {
  try {
    const res = await fetch(META_URL, { headers: authHeaders() })
    const json = await res.json()
    if (json && json.code === 0 && json.data) meta.value = json.data
  } catch {
    /* meta 失败不阻塞 */
  }
}

async function loadStatus() {
  try {
    const res = await fetch(STATUS_URL, { headers: authHeaders() })
    const json = await res.json()
    if (json && json.code === 0 && json.data) kg.value = json.data
  } catch {
    /* 状态失败不阻塞 */
  }
}

/**
 * 拉曲库。后端一次性返回全部（`<music-player>` 本来就不支持分页），
 * 每首的 url / coverUrl 由后端注入签名，这里只做「可播 / 不可播」分流。
 */
async function loadSongs() {
  loading.value = true
  try {
    const res = await fetch(PLAYLIST_URL, { headers: authHeaders() })
    const json = await res.json()
    const items = (json && json.data && json.data.items) || []
    applyItems(items)
  } catch (e) {
    console.error('[music] 歌曲列表加载失败:', e)
  } finally {
    loading.value = false
    maybeBind()
  }
}

/** 分流到「可播 / 不可播」两个数组，并重建播放顺序（保持 displayed 与播放器同构） */
function applyItems(items) {
  // 后端注入的流/封面地址是**相对路径**（/api/music/stream/<name>?exp=…&sig=…），
  // 跨域部署时必须补上 API 基址 —— <audio>/<img> 不会走 axios，拿到的就是原样字符串，
  // 不补前缀就会去前端域名（Vercel 静态站）上取，必然是 404。
  const withBase = (s) => ({ ...s, url: assetUrl(s.url), coverUrl: assetUrl(s.coverUrl) })
  allSongs.value = items.filter((s) => s.playable).map(withBase)
  lockedSongs.value = items.filter((s) => !s.playable).map(withBase)
  order.value = allSongs.value.map((_, i) => i)
}

/**
 * 签名过期后**就地续期**，不重灌列表。
 *
 * 关键：`setSongs()` 内部会 `playSong(0, true)` —— 长播时重灌列表等于把播放拉回第 0 首，
 * 是灾难。这里只按 filename 原地更新 url / coverUrl，下标与当前曲目全都不动。
 *
 * @returns {Promise<string>} 当前曲的新 url（拿不到时为空串）
 */
async function refreshUrls(filename) {
  try {
    const res = await fetch(PLAYLIST_URL, { headers: authHeaders() })
    const json = await res.json()
    const items = (json && json.data && json.data.items) || []
    const byName = new Map(items.map((s) => [s.filename, s]))
    for (const s of allSongs.value) {
      const fresh = byName.get(s.filename)
      if (!fresh) continue
      // 同样补 API 基址：续签拿到的是新的相对地址
      s.url = assetUrl(fresh.url)
      s.coverUrl = assetUrl(fresh.coverUrl)
      s.hasCover = fresh.hasCover
    }
    return assetUrl(byName.get(filename)?.url || '')
  } catch {
    return ''
  }
}

/* ---------- 播放器控制 ---------- */

// 注入组件脚本（幂等）
function loadPlayerScript() {
  if (window.customElements.get('music-player')) return Promise.resolve()
  if (window.__mpScriptPromise) return window.__mpScriptPromise
  window.__mpScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = MP_SCRIPT
    s.onload = () => {
      if (window.customElements.get('music-player')) resolve()
      else reject(new Error('脚本加载完成但组件未注册'))
    }
    s.onerror = () => reject(new Error('组件脚本加载失败'))
    document.head.appendChild(s)
  })
  return window.__mpScriptPromise
}

function onSongChange(e) {
  currentIdx.value = e.detail && e.detail.index != null ? e.detail.index : -1
  // 换歌了，进度清零（新曲的 duration 由 loadedmetadata 补上）
  curTime.value = 0
  durTime.value = 0
  // 换歌顺带把歌词和封面色换成新的（currentSong 依赖刚写好的 currentIdx，这里取已是新值）
  const s = currentSong.value
  loadLyrics(s && s.filename)
  extractGlow(s && s.hasCover ? s.coverUrl : '')
}

function syncPlaying() {
  const el = player.value
  if (!el || !el.audio) return
  isPlaying.value = !el.audio.paused
  // 【新增动画】封面旋转 / 进度条的驱动开关都挂在播放状态上
  if (isPlaying.value) {
    startTick()
    // 全屏页可能是在暂停状态下展开的（那时 startPulse 因未解锁/未播放而空转），
    // 这里补一次，保证一按播放光环就起来
    startPulse()
    resumeGraph() // context 可能被浏览器挂起，播放时拉一把
  } else {
    stopTick()
    syncTimeOnce()
  }
}

/** 暂停或切歌时补一次读数，避免进度条停在上一次的 rAF 帧上 */
function syncTimeOnce() {
  const a = player.value && player.value.audio
  if (!a) return
  curTime.value = a.currentTime || 0
  if (a.duration && isFinite(a.duration)) durTime.value = a.duration
  updateCurLine()
}

// ---- 进度刷新：rAF 而不是 timeupdate + CSS transition ----
//
// timeupdate 只有约 4Hz，若再叠一层 transition 去「平滑」，填充会永远在追一个
// 每 250ms 跳一次的目标 —— 表现为持续滞后 + 拖动时爬行。直接按帧读 currentTime 最准。
let rafId = null
function startTick() {
  if (rafId) return
  rafId = requestAnimationFrame(tick)
}
function stopTick() {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = null
}
function tick() {
  const a = player.value && player.value.audio
  if (a && !seeking.value) {
    curTime.value = a.currentTime || 0
    if (a.duration && isFinite(a.duration)) durTime.value = a.duration
  }
  updateCurLine()
  rafId = requestAnimationFrame(tick)
}

function bindPlayer() {
  const el = player.value
  if (!el || playerEl) return
  playerEl = el
  el.addEventListener('musicplayer:change', onSongChange)
  el.addEventListener('musicplayer:error', onPlayerError)
  if (el.audio) {
    el.audio.addEventListener('play', syncPlaying)
    el.audio.addEventListener('pause', syncPlaying)
    // 时长要等元数据到位才知道，切歌后必须重新取
    el.audio.addEventListener('loadedmetadata', syncTimeOnce)
    el.audio.addEventListener('durationchange', syncTimeOnce)
    // 音量/静音的初值从引擎实际状态读，不假设默认值
    volPct.value = clampVol((el.audio.volume != null ? el.audio.volume : 0.8) * 100)
    muted.value = !!el.audio.muted
  }
  installPlayMode(el)
  maybeBind()
}

/**
 * 接管「自动切歌」，实现播放模式。
 *
 * 组件在构造时就绑了 `audio.addEventListener('ended', () => this.nextSong())`，
 * 它会把控制权抢走；而自己再加一个 ended 监听来不及（同一目标上的监听器按注册顺序触发，
 * 组件那个先注册）。所以只能覆盖实例方法 —— 类方法是普通原型方法，直接赋值即可产生
 * 遮蔽的自有属性，而组件内部那两处调用（ended 回调、它自己的下一曲按钮）都是
 * **调用时** 才做 `this.nextSong` 查找，所以能命中我们这版。
 */
function installPlayMode(el) {
  if (el.__playModeInstalled) return
  // 组件升级后若 nextSong 没了，这里静默跳过 —— 否则 .bind 抛错会把整个 bindPlayer 拖垮
  if (typeof el.nextSong !== 'function') return
  el.__playModeInstalled = true
  const origNext = el.nextSong.bind(el)
  // 手动「下一曲」专用入口：它必须绕开模式逻辑，否则单曲循环下点下一曲只会重播当前曲
  el.__manualNext = origNext
  el.nextSong = function () {
    // 用户显式排的「下一首播放」优先，任何模式下都先按队列走
    if (el._nextUp && el._nextUp.length) return origNext()
    if (playMode.value === 'single') {
      const a = el.audio
      if (!a) return origNext()
      try { a.currentTime = 0 } catch { /* 元数据未就绪时忽略 */ }
      a.play().catch(() => {})
      return
    }
    // list（原生 +1 取模，天然就是列表循环）与 shuffle（顺序已在 order 里洗过）都走线性
    return origNext()
  }
}

/**
 * 播放出错。最常见的原因是**媒体签名过期**（TTL 12h，长驻页面会撞上），
 * 所以这里先续一次签名再原位置回 src，续签无效才交给用户。
 */
async function onPlayerError() {
  const el = player.value
  const cur = el && el.getCurrentSong && el.getCurrentSong()
  if (!cur || !el.audio) return
  const fresh = await refreshUrls(cur.filename)
  if (!fresh) return
  const a = el.audio
  const at = a.currentTime
  const wasPlaying = !a.paused
  a.src = fresh
  // 元数据就绪后再定位，否则 seek 会被丢弃
  a.addEventListener(
    'loadedmetadata',
    () => {
      try { a.currentTime = at } catch { /* 越界忽略 */ }
      if (wasPlaying) a.play().catch(() => {})
    },
    { once: true },
  )
}

function pushToPlayer() {
  const el = player.value
  if (!el || !allSongs.value.length) return
  el.setSongs(displayed.value)
}

// 把当前展示列表灌进播放器（首次）
function maybeBind() {
  if (bound || scriptState.value !== 'ready' || !allSongs.value.length || !player.value) return
  bound = true
  pushToPlayer()
}

/**
 * 同步/换绑之后曲库变了，需要把新列表交给播放器。
 * ⚠️ 正在播放时**绝不重灌** —— setSongs 会 playSong(0, true)，等于把用户正在听的歌切掉。
 * 这种情况下只更新页面列表并提示刷新。
 */
function syncPlayerAfterLibraryChange() {
  if (!player.value) return
  if (isPlaying.value) {
    ElMessage.info('曲库已更新。为避免打断当前播放，刷新页面后播放列表才会同步。')
    return
  }
  bound = true
  pushToPlayer()
}

function playAt(di) {
  const el = player.value
  if (el && di >= 0) el.play(di)
}

function togglePlay() {
  const el = player.value
  if (!el || !el.audio) return
  if (isPlaying.value) el.audio.pause()
  else if (el.getCurrentSong && el.getCurrentSong()) el.audio.play().catch(() => {})
  else playAt(0)
}

/** 手动「下一曲」：走 __manualNext，绕开单曲循环的接管 */
function nextTrack() {
  const el = player.value
  if (!el) return
  if (typeof el.__manualNext === 'function') el.__manualNext()
  else if (typeof el.nextSong === 'function') el.nextSong()
}

/** 手动「上一曲」：prevSong 从未被覆盖，任何模式下都是线性后退 */
function prevTrack() {
  const el = player.value
  if (el && typeof el.prevSong === 'function') el.prevSong()
}

/** 循环切换播放模式 */
function cycleMode() {
  const i = PLAY_MODES.findIndex((m) => m.key === playMode.value)
  setMode(PLAY_MODES[(i + 1) % PLAY_MODES.length].key)
}

/**
 * 切到随机模式（或从随机切回）时重排播放顺序。
 *
 * 随机是**建立在既有的 order 之上**的：洗一次顺序，之后 nextSong/prevSong 照常线性走。
 * 这样手动「上一曲」才是真正的上一首（若改成「随机挑一个下标」，上一曲会跳到无关曲目）。
 * 代价是列表会可见地重排 —— 这是本页既有行为（原来的「随机播放」按钮就是这么做的）。
 */
function setMode(mode) {
  const el = player.value
  const prev = playMode.value
  playMode.value = mode
  if (!el || !allSongs.value.length) return
  if (mode === 'shuffle') reshuffleOrder(true)
  else if (prev === 'shuffle') reshuffleOrder(false)
}

/** 重排 order（shuffle=true 洗牌，false 恢复自然序），并尽量不打断当前播放 */
function reshuffleOrder(shuffle) {
  const el = player.value
  if (!el) return
  const curName = currentSong.value && currentSong.value.filename
  const arr = allSongs.value.map((_, i) => i)
  if (shuffle) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
  }
  order.value = arr

  const a = el.audio
  const at = a ? a.currentTime : 0
  const wasPlaying = a ? !a.paused : false
  el.setSongs(displayed.value) // 这一步必然把播放器拉到第 0 首，下面把它找回来
  const di = curName ? displayed.value.findIndex((s) => s.filename === curName) : -1
  if (di < 0) return
  currentIdx.value = di
  el.playSong(di, true) // 静默加载，不自动播
  if (!a) return
  a.addEventListener(
    'loadedmetadata',
    () => {
      try { a.currentTime = at } catch { /* 越界忽略 */ }
      if (wasPlaying) a.play().catch(() => {})
    },
    { once: true },
  )
}

/** 把这首歌插到当前曲之后，当前曲放完接着播（FIFO 队列） */
function playNext(x) {
  const el = player.value
  if (!el || typeof el.playNext !== 'function') return
  el.playNext(x.song)
  // 按钮瞬时反馈：显示「已加入」1.6s
  const fn = x.song.filename
  clearTimeout(nextTimers[fn])
  nextMark.value = { ...nextMark.value, [fn]: true }
  nextTimers[fn] = setTimeout(() => {
    nextMark.value = { ...nextMark.value, [fn]: false }
  }, 1600)
}

/* ---------- 进度条 / 音量条（自绘） ---------- */

const progressPct = computed(() => {
  if (!durTime.value) return 0
  return Math.min(100, Math.max(0, (curTime.value / durTime.value) * 100))
})
/** range 用 0–1000 而不是 0–100：长歌按整数百分比会一跳好几秒 */
const seekValue = computed(() => Math.round(progressPct.value * 10))

function onSeekInput(e) {
  if (!durTime.value) return
  // 拖动期间只更新显示，真正的 seek 放在 change（松手）时做
  curTime.value = (Number(e.target.value) / 1000) * durTime.value
}
function onSeekChange(e) {
  seeking.value = false
  const a = player.value && player.value.audio
  if (!a || !durTime.value) return
  try {
    a.currentTime = (Number(e.target.value) / 1000) * durTime.value
  } catch { /* 元数据未就绪时忽略 */ }
  updateCurLine() // 暂停状态下 seek，歌词高亮也要跟上
}

/** setVolume 内部是 `audio.volume = v/100`，越界会**抛异常**（不是静默夹紧），所以必须自己夹 */
function clampVol(v) {
  return Math.max(0, Math.min(100, Math.round(v)))
}
const volShown = computed(() => (muted.value ? 0 : volPct.value))

function onVolInput(e) {
  const el = player.value
  if (!el) return
  const v = clampVol(Number(e.target.value) / 10) // range 是 0–1000，换算回 0–100
  volPct.value = v
  // 音量拉离 0 就自动解除静音，否则「有音量但没声音」很困惑
  if (v > 0 && muted.value) {
    muted.value = false
    if (el.audio) el.audio.muted = false
  }
  if (typeof el.setVolume === 'function') el.setVolume(v)
}

function toggleMute() {
  const el = player.value
  if (!el || !el.audio) return
  // 自己管 audio.muted：组件的 toggleMute() 只更新它那些隐藏的图标，也不返回状态
  muted.value = !muted.value
  el.audio.muted = muted.value
}

/* ---------- 全屏播放页 ---------- */

/**
 * 自己抓歌词，**不用**组件现成的 `player.lyrics`。
 *
 * 那是组件实例上的普通属性，Vue 追踪不到它的变化（切歌后视图不会更新），
 * 而且组件抓完歌词也不会派发任何事件。走同一个后端接口拿 `[{time, text}]` 最省心。
 * 注意该接口是 requireAuth，必须带上 token。
 */
async function loadLyrics(filename) {
  if (!filename || lyricsFor.value === filename) return
  lyricsFor.value = filename
  lyrics.value = []
  curLine.value = -1
  try {
    const res = await fetch(`${LYRICS_URL}/${encodeURIComponent(filename)}`, { headers: authHeaders() })
    const json = await res.json()
    if (json && json.code === 0 && json.data) lyrics.value = json.data.lyrics || []
  } catch {
    lyrics.value = []
  }
}

/**
 * 从封面图取一个主色做光晕（参考图里那圈青色辉光就是这么来的）。
 *
 * 封面走同源的 /api/music/cover/*，canvas 不会被跨域污染，可以直接 getImageData。
 * 缩到 16×16 求平均即可，几乎不耗时；任何失败都退回中性白，不影响可用性。
 */
async function extractGlow(url) {
  glowColor.value = 'rgba(255, 255, 255, 0.16)'
  if (!url) return
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const c = document.createElement('canvas')
    c.width = c.height = 16
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0, 16, 16)
    const d = ctx.getImageData(0, 0, 16, 16).data
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]
      g += d[i + 1]
      b += d[i + 2]
      n++
    }
    // 平均色通常偏暗，提亮一档之后光晕才显得出来（否则糊成一片灰）
    const k = 1.7
    r = Math.min(255, Math.round((r / n) * k))
    g = Math.min(255, Math.round((g / n) * k))
    b = Math.min(255, Math.round((b / n) * k))
    glowColor.value = `rgba(${r}, ${g}, ${b}, 0.5)`
  } catch {
    /* 图挂了/解码失败：保持中性光晕 */
  }
}

/** 按当前播放时间算出歌词行（后端已按 time 升序，遇到未来行即可停） */
function computeCurLine() {
  const ls = lyrics.value
  const t = curTime.value
  let idx = -1
  for (let i = 0; i < ls.length; i++) {
    if (ls[i].time <= t) idx = i
    else break
  }
  return idx
}

/**
 * 把当前行滚到歌词区正中。
 * 只在**下标变化时**才写 curLine —— tick 是每帧跑的，无条件赋值会每帧重渲染整段歌词。
 */
function updateCurLine() {
  const idx = computeCurLine()
  if (idx !== curLine.value) curLine.value = idx
}

/**
 * 点击歌词行：跳到该句的时间点。
 * 与进度条 seek（onSeekChange）同模式 —— 直接改 currentTime，再立刻刷高亮，
 * 所以暂停时点歌词，高亮也会马上跟过去。无时间戳的行（l.time 非有限数）忽略。
 */
function seekToLyric(l) {
  const a = player.value && player.value.audio
  if (!a || !l || !isFinite(l.time)) return
  try {
    a.currentTime = l.time
  } catch { /* 元数据未就绪时忽略 */ }
  updateCurLine() // 暂停状态下 seek，歌词高亮也要跟上
}

function scrollToActive(smooth = true) {
  const box = lyricBox.value
  const el = box && box.querySelector('.mn-lyric-line.active')
  if (!box || !el) return
  const top = el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2
  if (smooth) box.scrollTo({ top, behavior: 'smooth' })
  else box.scrollTop = top
}

watch(curLine, async (i) => {
  if (i < 0 || !expanded.value) return
  await nextTick()
  scrollToActive(true)
})

// 展开时歌词区才刚挂载：立即定位一次，否则会停在最顶上
watch(expanded, async (on) => {
  if (!on) return
  // 暂停状态下 tick 是停的（syncPlaying 里 isPlaying 为假就走 stopTick），
  // 不在这里补一次读数，全屏页进度条会一直停在 0:00 直到用户再次播放
  syncTimeOnce()
  await nextTick()
  curLine.value = computeCurLine()
  await nextTick()
  scrollToActive(false)
})

/* ---------- 脉冲光环：Web Audio 真实频谱 ---------- */
//
// 本项目首次引入 Web Audio。有三个必须守住的点，否则轻则没光环、重则**整体静音**：
//  1) createMediaElementSource 会夺走 audio 元素的输出，必须再接回 ctx.destination；
//  2) 新建的 AudioContext 处于 suspended，挂起状态下接线 == 全程无声 ——
//     所以只在**用户手势之后**才接线（autoplay 策略）；
//  3) 同一个 audio 元素只能 createMediaElementSource 一次（再调抛
//     InvalidStateError），所以要记住已接线的元素，元素换了才重建。
//
// gsap.js 的 prefersReducedMotion 是模块私有 const、没有 export，这里内联等价判断。
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches

const BAR_COUNT = 64       // 进度条上方横向铺开的线段数
const BIN_COUNT = 64       // 取用的频段宽度（fftSize 256 → 128 bin，只用前半）

const vizEl = ref(null)
let audioCtx = null
let analyser = null
let freqData = null
let srcNode = null
let boundAudio = null      // srcNode 当前接的是哪个 audio 元素
let pulseRaf = null
const barVals = new Float32Array(BAR_COUNT) // 每条线平滑后的能量 0..1
const barPeaks = new Float32Array(BAR_COUNT) // 每条线的滚动峰值（自适应增益用）
let audioUnlocked = false  // 是否已发生过用户手势

// canvas 几何：在 resizeViz 里量一次就缓存下来 —— getBoundingClientRect 会强制
// 同步布局，绝不能放在每帧都要跑的热路径上
let vizCtx = null
let vizW = 0
let vizH = 0

/**
 * 第 i 条线取哪个 bin：从左到右 = 低频到高频。
 *
 * 低频段（左边 1/3 的线）逐 bin 线性铺开，保证每根线独占一个频段；剩下的再指数
 * 拉向高频（那里本来就没细节，相邻几根取到同一个 bin 无所谓）。
 * 不用纯幂映射的原因：`round(t² · 63)` 在低端会连着一串取整到同一个 bin，
 * 最左边 6 根线高度一模一样，看起来是一块实心方块而不是一根根线。
 */
const LINEAR_SHARE = Math.round(BAR_COUNT / 3)
const BINS = Array.from({ length: BAR_COUNT }, (_, i) => {
  if (i < LINEAR_SHARE) return 1 + i
  const t = (i - LINEAR_SHARE) / (BAR_COUNT - 1 - LINEAR_SHARE)
  return LINEAR_SHARE + 1 + Math.round(Math.pow(t, 1.6) * (BIN_COUNT - LINEAR_SHARE - 1))
})

// 自适应增益：高频能量天生比低频低几个数量级，只靠上面的分布仍然会「只有左边
// 在跳」。每根线再除以自己的滚动峰值，归一化出各自的动态范围。
//
// ↓↓↓ 灵敏度调节区：线条太跳就调小这几个，太死板就调大 ↓↓↓
const AGC_FLOOR = 0.10   // 峰值低于此值视为静音 —— 调高 = 安静段落干脆不画（最有效的一档）
const AGC_DECAY = 0.995  // 峰值衰减（约 3 秒时间常数）
const VIZ_GAMMA = 1.9    // 幂压缩指数 —— 调高 = 弱拍更矮，整体更克制
const VIZ_GAIN = 0.9     // 每根线顶到自己峰值时能有多高 —— 调低 = 整体更矮
const VIZ_ATTACK = 0.26  // 起音速度 —— 调低 = 不那么一惊一乍
const VIZ_RELEASE = 0.06 // 回落速度 —— 调低 = 余韵更长
// ↑↑↑ 上面这组是「灵敏度 = 1」时的基准手感 ↑↑↑

// ── 频谱灵敏度：用户可在全屏页自己调 ──────────────────────────────────
const VIZ_SENS_KEY = 'mn-viz-sens'
const VIZ_SENS_MIN = 0.5
const VIZ_SENS_MAX = 2

function loadVizSens() {
  try {
    const v = parseFloat(localStorage.getItem(VIZ_SENS_KEY))
    if (Number.isFinite(v)) return Math.min(VIZ_SENS_MAX, Math.max(VIZ_SENS_MIN, v))
  } catch {
    // 隐私模式 / 禁用存储时 localStorage 会直接抛，忽略即可，退回默认
  }
  return 1
}

const vizSens = ref(loadVizSens())
const vizOpen = ref(false) // 灵敏度面板是否展开
watch(vizSens, (v) => {
  try {
    localStorage.setItem(VIZ_SENS_KEY, String(v))
  } catch {
    /* 存不上就算了，本次会话内仍然生效 */
  }
})

/** 滑杆填充百分比（0.5× → 0%，2× → 100%） */
const sensPct = computed(
  () => ((vizSens.value - VIZ_SENS_MIN) / (VIZ_SENS_MAX - VIZ_SENS_MIN)) * 100
)

/**
 * 把 0.5×…2× 换算成实际旋钮取值；s = 1 时与上面那组常量完全相等。
 *
 * 为什么是四个旋钮一起动，而不是简单地整体乘一个系数：只乘增益的话，
 * 很快就撞上 Math.min(1, …) 的天花板，再往上调滑块一点反应都没有。
 * 所以同时放宽静音门限（更多频段参与）和压低幂指数（弱拍也抬起来），
 * 让整条行程都有可见变化。
 */
const vizProfile = computed(() => {
  const s = vizSens.value
  return {
    gain: Math.min(1, VIZ_GAIN * s),
    gamma: Math.min(3, Math.max(1, VIZ_GAMMA / s)),
    floor: AGC_FLOOR / s,
    attack: VIZ_ATTACK * (0.6 + 0.4 * s),
  }
})

/** 挂起的 context 等于静音，播放时要拉起来 */
function resumeGraph() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
}

/**
 * 真正接线。**只允许在 audioCtx 确认 running 之后调用** ——
 * 接线顺序刻意是「先接 destination，再分叉出 analyser」，
 * 这样即使 analyser 创建失败，声音也已经接回扬声器，不会哑掉。
 */
function connectGraph(a) {
  try {
    srcNode = audioCtx.createMediaElementSource(a)
    srcNode.connect(audioCtx.destination) // ⚠️ 漏了这行 = 整体静音
    try {
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.86 // 帧间抖动先在这里压一道
      freqData = new Uint8Array(analyser.frequencyBinCount)
      srcNode.connect(analyser) // 分析支路到此为止，不再接 destination（否则双份输出）
    } catch {
      analyser = null
      freqData = null // 只是没光环，出声不受影响
    }
    boundAudio = a
    return !!analyser
  } catch (e) {
    // InvalidStateError：该元素已经建过 source（HMR 复用同一元素时常见）。
    // 降级为「没有光环」，绝不影响播放。
    console.warn('[music] 频谱接入失败，光环降级为静态:', e)
    srcNode = analyser = freqData = null
    boundAudio = null
    return false
  }
}

/**
 * 建立（或复用）音频图。返回 true 表示 analyser 可用。
 *
 * ⚠️ 这里有个很容易踩的静音陷阱：resume() 是**异步**的，而
 * createMediaElementSource 一旦调用就立刻接管该元素的输出。若在 ctx 还处于
 * suspended 时接线，声音就再也出不来了。startPulse 又是由 watch 触发的，
 * 不在 pointerdown 的同步栈里，所以新建的 ctx 完全可能是 suspended。
 * 因此：先等 resume() 落地、确认 running，再接线；恢复失败就干脆不接。
 */
function ensureGraph() {
  const a = player.value && player.value.audio
  if (!a) return false
  if (srcNode && boundAudio === a) { resumeGraph(); return !!analyser }
  if (boundAudio && boundAudio !== a) teardownGraph() // audio 换过了，先拆旧图
  if (!audioUnlocked) return false // 没发生过用户手势，绝不接线（autoplay 政策）

  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return false
  if (!audioCtx) audioCtx = new AC()

  if (audioCtx.state !== 'running') {
    audioCtx
      .resume()
      .then(() => { if (audioCtx && audioCtx.state === 'running') connectGraph(a) })
      .catch(() => { /* 恢复失败：保持不接线，宁可没光环也不能变哑巴 */ })
    return false
  }
  return connectGraph(a)
}

function teardownGraph() {
  try { srcNode && srcNode.disconnect() } catch { /* 已断开 */ }
  try { analyser && analyser.disconnect() } catch { /* 已断开 */ }
  try { audioCtx && audioCtx.close() } catch { /* 已关闭 */ }
  audioCtx = analyser = freqData = srcNode = boundAudio = null
}

/** 用户手势：唯一能可靠解除 AudioContext 挂起的时机 */
function onUserGesture() {
  audioUnlocked = true
  if (expanded.value) ensureGraph()
}

/** 量一次 canvas 尺寸并缓存。DPR 上限取 2 —— 线条只有 3px 宽，
    再高的倍率只烧显卡不出效果。 */
function resizeViz() {
  const el = vizEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  el.width = Math.round(rect.width * dpr)
  el.height = Math.round(rect.height * dpr)
  vizCtx = el.getContext('2d')
  vizCtx.setTransform(dpr, 0, 0, dpr, 0, 0) // 之后都按 CSS 像素坐标画
  vizW = rect.width
  vizH = rect.height
}

/** glowColor 形如 rgba(r, g, b, 0.5)，那个 alpha 是给 box-shadow 的虚影用的，
    线条要实打实看得见，所以只取色相，透明度交给 globalAlpha。 */
function lineStroke() {
  const m = /rgba?\(([^)]+)\)/.exec(glowColor.value)
  if (!m) return 'rgb(255, 255, 255)'
  const [r, g, b] = m[1].split(',').map((s) => s.trim())
  return `rgb(${r}, ${g}, ${b})`
}

function drawViz() {
  if (!vizCtx || !vizW) return
  const ctx = vizCtx
  ctx.clearRect(0, 0, vizW, vizH)

  // 每条线占一个 slot，线本身只占 slot 的一部分宽，其余留作间隙
  const slot = vizW / BAR_COUNT
  const lw = Math.min(3, Math.max(1.5, slot * 0.5))
  const base = vizH - 1   // 底边（留 1px 呼吸）
  const maxH = vizH - 2

  ctx.strokeStyle = lineStroke()
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  ctx.globalAlpha = 0.9

  // 64 条同色同宽的线合成一条 path，只 stroke 一次 ——
  // 逐条 beginPath/stroke 会把状态检查重复 64 遍，白费。
  ctx.beginPath()
  for (let i = 0; i < BAR_COUNT; i++) {
    const x = slot * (i + 0.5)   // slot 中心
    const h = 2 + barVals[i] * maxH
    ctx.moveTo(x, base)
    ctx.lineTo(x, base - h)
  }
  ctx.stroke()
  ctx.globalAlpha = 1
}

function pulseTick() {
  // canvas 刚挂载（或窗口尺寸变过）时还没量过，这里兜一次
  if (!vizCtx || !vizW) resizeViz()

  const ready = isPlaying.value && analyser && freqData
  if (ready) analyser.getByteFrequencyData(freqData)

  // 灵敏度换算出的实际旋钮（见 vizProfile），每帧取一次，改滑块下一帧就生效
  const P = vizProfile.value

  let alive = false
  for (let i = 0; i < BAR_COUNT; i++) {
    let target = 0
    if (ready) {
      const raw = freqData[BINS[i]] / 255
      // 峰值缓降、瞬态立刻跟上；再按自己的峰值归一化，
      // 高频段才会有和低频段一样明显的动态
      const pk = Math.max(raw, barPeaks[i] * AGC_DECAY)
      barPeaks[i] = pk
      // 幂压缩：按自己的峰值归一化后再压一次，指数与上限见上方灵敏度区
      target = pk > P.floor ? Math.min(1, Math.pow(raw / pk, P.gamma) * P.gain) : 0
    }
    const cur = barVals[i]
    // 非对称包络：起音快（跟得上鼓点）、回落慢（像余韵）
    const next = cur + (target - cur) * (target > cur ? P.attack : VIZ_RELEASE)
    barVals[i] = next
    if (next > 0.004) alive = true
  }

  drawViz()

  // 暂停、且线条已经落干净了 → 停表（省得 rAF 空转）。
  // 但**播放中**即使还没拿到频谱也要活着等：AudioContext.resume() 是异步的，
  // 这里一停就再没人把 rAF 拉起来，线条会永远不动。
  if (!alive && !isPlaying.value) {
    pulseRaf = null
    return
  }
  pulseRaf = requestAnimationFrame(pulseTick)
}

function startPulse() {
  if (pulseRaf || REDUCED_MOTION || !audioUnlocked) return
  ensureGraph()
  resizeViz()
  pulseRaf = requestAnimationFrame(pulseTick)
}
function stopPulse() {
  if (pulseRaf) cancelAnimationFrame(pulseRaf)
  pulseRaf = null
  barVals.fill(0)
  barPeaks.fill(0)
  if (vizCtx && vizW) vizCtx.clearRect(0, 0, vizW, vizH)
}

/* 线条的启停只跟「全屏页展开」走，**与播放状态无关** ——
   播放与否只决定能量来源（读频谱 vs 向 0 衰减）。暂停时让 rAF 自己衰减到
   静止再停表，所以这里不需要在暂停时中断它。
   flush:'post' 是必须的：canvas 在 v-if 里，pre-flush 阶段它刚挂载、ref 还是
   null，resizeViz 量不到尺寸，之后也没人再补量，线条就永远画不出来。 */
watch(expanded, (on) => (on ? startPulse() : stopPulse()), { flush: 'post' })

/** 全屏页开着时改窗口大小/浏览器缩放：canvas 的 CSS 尺寸变了，
    像素缓冲得重新对齐，否则线条会糊或错位。 */
function onWindowResize() {
  if (!expanded.value) return
  resizeViz()
  drawViz() // 暂停时 rAF 已经停了，得补画一帧
}

function onKeydown(e) {
  if (e.key === 'Escape' && expanded.value) expanded.value = false
}

/* ---------- 酷狗绑定 / 同步（管理员） ---------- */

/**
 * 打开扫码弹窗并开始轮询。
 *
 * ⚠️ 轮询必须**带变化的 timestamp**，否则会命中 KuGouMusicApi 的服务端 2 分钟缓存、
 * 状态永远停在「待扫描」。这件事由后端的 `fresh: true` 保证，前端只管按节奏问。
 */
async function openBind() {
  qr.value = { open: true, key: '', image: '', status: 0, expired: false }
  stopPoll()
  try {
    const res = await fetch(`${KUGOU}/qr`, { headers: authHeaders() })
    const json = await res.json()
    if (!res.ok || json.code !== 0) throw new Error(json.message || `HTTP ${res.status}`)
    qr.value.key = json.data.key
    qr.value.image = json.data.qrImage
    qrTimer = setInterval(pollQr, 2000)
  } catch (e) {
    closeBind()
    ElMessage.error(`获取二维码失败：${e.message}`)
  }
}

function stopPoll() {
  if (qrTimer) clearInterval(qrTimer)
  qrTimer = null
}

function closeBind() {
  stopPoll()
  qr.value.open = false
}

/** 0 过期 / 1 待扫描 / 2 待确认 / 4 成功 */
async function pollQr() {
  if (!qr.value.key) return
  try {
    const res = await fetch(`${KUGOU}/qr/check?key=${encodeURIComponent(qr.value.key)}`, {
      headers: authHeaders(),
    })
    const json = await res.json()
    if (!res.ok || json.code !== 0) throw new Error(json.message || `HTTP ${res.status}`)
    qr.value.status = json.data.status

    if (json.data.status === 4) {
      stopPoll()
      closeBind()
      ElMessage.success(`已绑定酷狗账号：${json.data.nickname || '（未取到昵称）'}`)
      await doSync()
    } else if (json.data.status === 0) {
      // 二维码过期就地重取，不用用户手动重开
      stopPoll()
      qr.value.expired = true
    }
  } catch (e) {
    stopPoll()
    ElMessage.error(`扫码状态查询失败：${e.message}`)
  }
}

async function doSync(playlistId) {
  syncing.value = true
  try {
    const res = await fetch(`${KUGOU}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(playlistId ? { playlistId } : {}),
    })
    const json = await res.json()

    // 409 = 认不出哪个是「我喜欢」，把候选交给用户点
    if (res.status === 409) {
      picker.value = { open: true, candidates: (json.data && json.data.candidates) || [] }
      return
    }
    if (!res.ok || json.code !== 0) throw new Error(json.message || `HTTP ${res.status}`)

    picker.value.open = false
    const d = json.data
    ElMessage.success(
      `同步完成：${d.playlist.name} 共 ${d.total} 首（新增 ${d.added}，更新 ${d.updated}${d.removed ? `，移出 ${d.removed}` : ''}）`,
    )
    await Promise.all([loadSongs(), loadMeta(), loadStatus()])
    syncPlayerAfterLibraryChange()
  } catch (e) {
    ElMessage.error(`同步失败：${e.message}`)
  } finally {
    syncing.value = false
  }
}

async function doUnbind() {
  try {
    const res = await fetch(`${KUGOU}/unbind`, { method: 'POST', headers: authHeaders() })
    const json = await res.json()
    if (!res.ok || json.code !== 0) throw new Error(json.message || `HTTP ${res.status}`)
    ElMessage.success('已解绑。已下载到本地的歌曲仍可正常播放。')
    await Promise.all([loadSongs(), loadMeta(), loadStatus()])
    // 解绑后可播集合会缩小，重灌一次让播放器与页面列表保持一致
    if (player.value && !isPlaying.value) syncPlayerAfterLibraryChange()
  } catch (e) {
    ElMessage.error(`解绑失败：${e.message}`)
  }
}

/* ---------- 一键下载歌单 ---------- */

const DL_INTERVAL = 1500
const DL_MAX_MISSES = 10

function stopDlPoll() {
  if (dlTimer) {
    clearTimeout(dlTimer)
    dlTimer = null
  }
}

function scheduleDlPoll() {
  stopDlPoll()
  dlTimer = setTimeout(pollDownload, DL_INTERVAL)
}

/**
 * 轮询下载进度。
 *
 * 两个必须守住的点：
 *   1. 后端回 `active:false` 而本地还以为在下载 → 批次已结束或被中断（后端重启会让内存态
 *      归零），立刻收尾。少了这条，界面会永远停在「下载中 17/48」。
 *   2. 结束后**只刷 `loadStatus()`，绝不 `loadSongs()`** —— `applyItems` 会重置播放顺序、
 *      `setSongs` 会把播放拉回第 0 首。批量下载只是多了本地缓存，列表不需要重灌。
 */
async function pollDownload() {
  let d = null
  try {
    const res = await fetch(`${DL}/progress`, { headers: authHeaders() })
    const json = await res.json()
    if (res.ok && json.code === 0 && json.data) d = json.data
  } catch {
    /* 网络抖动，下面按 miss 计数 */
  }

  if (!d) {
    if (++dlMisses >= DL_MAX_MISSES) {
      dlMisses = 0
      dlSeenActive = false
      stopDlPoll()
      ElMessage.warning('已停止跟踪下载进度（后端无响应），请刷新页面查看结果')
    } else {
      scheduleDlPoll()
    }
    return
  }

  dlMisses = 0
  const wasActive = dlSeenActive
  dl.value = d

  if (d.active) {
    dlSeenActive = true
    scheduleDlPoll()
    return
  }

  dlSeenActive = false
  stopDlPoll()
  if (!wasActive) return // 页面加载时顺手查到的闲置状态，不用提示
  notifyDownloadEnd(d)
  loadStatus() // 缓存计数变了，但曲库本身没变 —— 见上面第 2 点
}

function notifyDownloadEnd(d) {
  const done = `已完成 ${d.done}/${d.total} 首`
  const failed = d.failed ? `，失败 ${d.failed} 首` : ''
  if (d.cancelled) ElMessage.info(`已取消下载（${done}${failed}）`)
  else if (d.abortReason) ElMessage.warning(`${done}${failed}，已停止：${d.abortReason}`)
  else if (d.failed) ElMessage.warning(`${done}${failed}`)
  else ElMessage.success(`${done}，已全部缓存到本地`)
}

async function startDownload() {
  if (dl.value.active || syncing.value) return
  try {
    const res = await fetch(DL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    })
    const json = await res.json()
    // 423 = 正在同步歌单，后端按互斥拒绝（同步会改 in_liked，同跑会白下已移出的歌）
    if (res.status === 423) {
      ElMessage.info(json.message || '正在同步歌单，请稍候再试')
      return
    }
    if (!res.ok || json.code !== 0) throw new Error(json.message || `HTTP ${res.status}`)
    const d = json.data
    dl.value = d

    if (!d.started) {
      if (d.reason === 'nothing-to-do') {
        ElMessage.info('歌单里的歌都已经缓存到本地了')
        return
      }
      // already-running：可能是别的标签页/先前启动的批次，接管进度显示
      ElMessage.info('下载已在进行中')
      if (d.active) {
        dlSeenActive = true
        scheduleDlPoll()
      }
      return
    }

    dlSeenActive = true
    ElMessage.success(`开始下载 ${d.total} 首，可继续做别的事`)
    scheduleDlPoll()
  } catch (e) {
    ElMessage.error(`启动下载失败：${e.message}`)
  }
}

async function cancelDownload() {
  try {
    const res = await fetch(`${DL}/cancel`, { method: 'POST', headers: authHeaders() })
    const json = await res.json()
    if (!res.ok || json.code !== 0) throw new Error(json.message || `HTTP ${res.status}`)
    // abort 是异步生效的，这里拿到的大概率还是 active:true；下一次轮询才见分晓
    dl.value = json.data
    ElMessage.info('正在停止…')
    scheduleDlPoll()
  } catch (e) {
    ElMessage.error(`取消失败：${e.message}`)
  }
}

function onLockedClick(s) {
  if (!kg.bound) {
    ElMessage.info(userStore.isAdmin() ? '点击上方「绑定酷狗」扫码登录后即可播放' : '该曲目尚未缓存到本地，需管理员绑定酷狗账号后才能播放')
    return
  }
  ElMessage.info(`「${s.title}」在酷狗需要会员或已下架，暂时无法播放`)
}

/** 列表行点击：可播的播放，不可播的只提示 */
function onRowClick(x) {
  if (x.locked) onLockedClick(x.song)
  else playAt(x.di)
}

function fmtTime(iso) {
  if (!iso) return ''
  // 后端时间是 UTC 且不带时区标记，直接 new Date 会按本地时区解释（差 8 小时）
  const d = parseServerTime(iso)
  return d ? d.toLocaleString() : iso
}

onMounted(async () => {
  // Esc 收起全屏播放页
  window.addEventListener('keydown', onKeydown)
  // 音频可视化的接线时机：autoplay 政策下，只有用户手势之后建 AudioContext
  // 才不会被浏览器挂起（挂起状态接线 = 全程静音）。用 capture 抢在业务逻辑前，
  // 保证「点播放」这一个手势里就已经解锁。
  window.addEventListener('pointerdown', onUserGesture, { capture: true })
  window.addEventListener('keydown', onUserGesture, { capture: true })
  // 频谱 canvas 的尺寸是量出来的，窗口变化时要重新量
  window.addEventListener('resize', onWindowResize)
  loadMeta()
  loadStatus()
  loadSongs()
  // 顺手查一次批量下载进度：刷新页面 / 换标签页进来时能接着看正在跑的批次
  // （线上该能力已下线，见 DOWNLOAD_ENABLED —— 否则每 1.5s 打一个 no-op 端点，最后弹「后端无响应」）
  if (DOWNLOAD_ENABLED) pollDownload()
  // 只揭示主内容区：底部播放条是 .music-page 的直接子元素（不在 .mn-main 里），
  // 所以给 .mn-main 留 transform 不会把它顶出视口。
  const content = document.querySelector('.music-page .mn-main')
  if (content) revealFrom(content, { y: 24, ease: 'back.out(1.4)' })
  try {
    await loadPlayerScript()
    scriptState.value = 'ready'
    // 等组件真正挂到 DOM 后再绑事件/灌数据
    requestAnimationFrame(bindPlayer)
  } catch (e) {
    scriptState.value = 'error'
    console.error('[music] 播放器装载失败:', e)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointerdown', onUserGesture, { capture: true })
  window.removeEventListener('keydown', onUserGesture, { capture: true })
  window.removeEventListener('resize', onWindowResize)
  stopPoll()
  stopDlPoll()
  stopTick()
  // AudioContext 必须随组件关闭，否则每次进出 /music 都会泄漏一个上下文
  stopPulse()
  teardownGraph()
  if (playerEl) {
    playerEl.removeEventListener('musicplayer:change', onSongChange)
    playerEl.removeEventListener('musicplayer:error', onPlayerError)
    if (playerEl.audio) {
      playerEl.audio.removeEventListener('play', syncPlaying)
      playerEl.audio.removeEventListener('pause', syncPlaying)
      playerEl.audio.removeEventListener('loadedmetadata', syncTimeOnce)
      playerEl.audio.removeEventListener('durationchange', syncTimeOnce)
    }
  }
  playerEl = null
})
</script>

<template>
  <div class="music-page">
    <!-- ==================== 侧边栏 ==================== -->
    <aside class="mn-side">
      <div class="mn-logo">
        <span class="mn-logo-mark">♪</span>
        <span class="mn-logo-text">音乐馆</span>
      </div>

      <nav class="mn-nav">
        <button
          v-for="t in TABS"
          :key="t.key"
          class="mn-nav-item"
          :class="{ active: navTab === t.key }"
          @click="pickTab(t.key)"
        >
          <!-- 【新增动画】左侧红色竖线：用 scaleX 从 0 展开（不用 width，避免触发布局） -->
          <span class="mn-nav-line" aria-hidden="true"></span>
          <svg class="mn-nav-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path :d="t.path" />
          </svg>
          <span class="mn-nav-label">{{ t.label }}</span>
          <span class="mn-nav-count">{{ tabCount(t.key) }}</span>
        </button>

      </nav>
    </aside>

    <!-- ==================== 主内容区（唯一可滚动） ==================== -->
    <main class="mn-main">
      <header class="mn-head">
        <div class="mn-head-top">
          <div class="mn-head-title">
            <h1>{{ pageTitle }}</h1>
            <p v-if="pageSub" class="mn-head-sub">{{ pageSub }}</p>
          </div>

          <div class="mn-head-tools">
            <div class="mn-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input v-model="search" type="text" placeholder="搜索歌曲 / 艺人 / 专辑…" />
            </div>
            <span class="mn-count">{{ visibleList.length }} / {{ allSongs.length + lockedSongs.length }}</span>
          </div>
        </div>

        <!-- 酷狗账号全站共用一份，因此绑定/同步/解绑只对管理员开放（后端同样有 requireAdmin 兜底） -->
        <div v-if="userStore.isAdmin()" class="mn-actions">
          <button v-if="!kg.bound" class="btn-kg" @click="openBind">绑定酷狗</button>
          <template v-else>
            <button class="btn-kg" :disabled="syncing || dl.active" @click="doSync()">
              {{ syncing ? '同步中…' : '同步「我喜欢」' }}
            </button>
            <!-- 一键把歌单拉全：走的是播放时那条下载链路，只是由服务端批量投递，
                 不需要逐首去点。下载中换成进度 + 取消。
                 线上（Vercel Serverless）没有长驻进程也没有持久磁盘，后端已把它降级为
                 no-op，因此这里直接置灰提示，不再发起必然无效的请求。 -->
            <template v-if="DOWNLOAD_ENABLED">
              <template v-if="dl.active">
                <button class="btn-kg" disabled>下载中 {{ dl.done }}/{{ dl.total }}</button>
                <button class="btn-kg ghost" @click="cancelDownload">取消下载</button>
              </template>
              <button v-else class="btn-kg" :disabled="syncing" @click="startDownload">下载全部</button>
            </template>
            <button
              v-else
              class="btn-kg ghost"
              disabled
              title="线上版音频由 CDN 按需直出，不需要也无法预下载到本地"
            >线上版不支持离线下载</button>
            <button class="btn-kg ghost" :disabled="dl.active" @click="doUnbind">解绑</button>
          </template>
        </div>

        <p class="kg-bar">
          <template v-if="kg.bound">
            酷狗已绑定<template v-if="kg.nickname">（{{ kg.nickname }}）</template>
            · 歌单「{{ kg.likedPlaylistName || '未同步' }}」
            · 已缓存 {{ kg.cachedCount }} / {{ kg.trackCount }} 首
            <template v-if="dl.active">
              · <span class="dl-live">正在下载 {{ dl.done }}/{{ dl.total }}<template v-if="dl.failed">（失败 {{ dl.failed }}）</template></span>
            </template>
            <template v-if="kg.restrictedCount">· {{ kg.restrictedCount }} 首受限</template>
            <template v-if="kg.lastSyncAt">· 上次同步 {{ fmtTime(kg.lastSyncAt) }}</template>
          </template>
          <template v-else>
            未绑定酷狗，当前只显示已下载到本地的 {{ kg.cachedCount }} 首
          </template>
        </p>
      </header>

      <!-- 列表头：列名，和下面的网格对齐 -->
      <div v-if="visibleList.length" class="mn-listhead">
        <span class="col-idx">#</span>
        <span class="col-title">标题</span>
        <span class="col-album">专辑</span>
        <span class="col-dur">时长</span>
        <span class="col-action"></span>
      </div>

      <div v-if="loading" class="list-state">加载中…</div>
      <div v-else-if="visibleList.length === 0" class="list-state">
        {{ emptyText }}
      </div>

      <ul v-else class="tracklist">
        <li
          v-for="(x, i) in visibleList"
          :key="x.song.hash || x.song.filename || i"
          class="track"
          :class="{ active: !x.locked && x.di === currentIdx, locked: x.locked }"
          @click="onRowClick(x)"
        >
          <span class="col-idx">
            <template v-if="x.locked"><span class="idx-lock">🔒</span></template>
            <template v-else>
              <span class="idx-num">{{ i + 1 }}</span>
              <span class="idx-play">▶</span>
              <span v-if="x.di === currentIdx && isPlaying" class="eq"><i></i><i></i><i></i></span>
            </template>
          </span>

          <span class="col-title">
            <span class="t-title">{{ x.song.title }}</span>
            <span class="t-artist">{{ x.song.artist }}</span>
          </span>
          <span class="col-album">{{ x.song.album }}</span>
          <span class="col-dur">{{ fmtDur(x.song.duration) }}</span>

          <span class="col-action">
            <span v-if="x.locked" class="locked-tag">{{ kg.bound ? '受限' : '未缓存' }}</span>
            <button
              v-else
              class="btn-playnext"
              :class="{ nexted: nextMark[x.song.filename] }"
              :title="nextMark[x.song.filename] ? '已加入下一首播放队列' : '把这首歌放到当前曲之后播'"
              @click.stop="playNext(x)"
            >
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 5v14l9-7zM14 6h2v12h-2z" /></svg>
              <span>{{ nextMark[x.song.filename] ? '已加入' : '下一首' }}</span>
            </button>
          </span>
        </li>
      </ul>

      <p v-if="scriptState === 'error'" class="player-error">
        😵 播放器装载失败：请确认后端已启动（音乐模块挂载于 /m）。
      </p>
    </main>

    <!-- ==================== 底部固定播放条 ==================== -->
    <!--
      用 absolute 而不是 fixed：页面根元素本身已经 fixed 到视口，这里跟着它走即可。
      而且路由切换时外层 <transition name="page"> 会挂上带 transform 的过渡类，
      若这里用 fixed，transform 祖先会把它的定位基准从视口改成那个祖先，播放条会飘。
    -->
    <footer class="mn-player">
      <!-- 左：封面（播放时旋转）+ 曲目信息。整块可点，展开全屏播放页 -->
      <div
        class="mn-now"
        role="button"
        tabindex="0"
        title="展开播放页"
        @click="expanded = true"
        @keydown.enter.prevent="expanded = true"
      >
        <!-- 【新增动画】封面：播放中持续旋转，暂停用 animation-play-state 冻结在当前角度
             （不能移除 animation，那样会立刻弹回 0°，看起来是「倒转回去」） -->
        <div class="mn-cover" :class="{ spinning: isPlaying }">
          <img
            v-if="currentSong && currentSong.hasCover && currentSong.coverUrl"
            :src="currentSong.coverUrl"
            alt=""
            @error="(e) => (e.target.style.display = 'none')"
          />
          <span
            v-else
            class="mn-cover-fallback"
            :style="{ background: coverGradient(currentSong && currentSong.title) }"
          >♪</span>
        </div>
        <div class="mn-now-meta">
          <span class="mn-now-title">{{ (currentSong && currentSong.title) || '未在播放' }}</span>
          <span class="mn-now-artist">{{ (currentSong && currentSong.artist) || '—' }}</span>
        </div>
        <!-- 可展开的提示：hover 时上浮一点 -->
        <svg class="mn-expand-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="m6 15 6-6 6 6" />
        </svg>
      </div>

      <!-- 中：控制按钮组 + 进度条 -->
      <div class="mn-ctrl">
        <div class="mn-btns">
          <button class="mn-btn" title="上一曲" @click="prevTrack">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM20 6v12l-9-6z" /></svg>
          </button>

          <button class="mn-btn mn-btn-main" :title="isPlaying ? '暂停' : '播放'" @click="togglePlay">
            <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </button>

          <button class="mn-btn" title="下一曲" @click="nextTrack">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM4 6v12l9-6z" /></svg>
          </button>

          <!-- 播放模式：图标随模式变化 -->
          <button class="mn-btn" :title="playModeInfo.label" @click="cycleMode">
            <svg v-if="playMode === 'list'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
            <svg v-else-if="playMode === 'single'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
              <path d="M11 10l1.5-1v6" stroke-width="2.4" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 3h5v5" /><path d="M4 20 21 3" />
              <path d="M21 16v5h-5" /><path d="m15 15 6 6" /><path d="M4 4l5 5" />
            </svg>
          </button>
        </div>

        <div class="mn-progress">
          <span class="mn-time">{{ fmtDur(curTime) }}</span>
          <!-- 填充不靠 CSS transition：timeupdate 只有 ~4Hz，过渡会一直追不上。
               这里由 rAF 每帧更新 --pct，本身就足够平滑 -->
          <input
            class="mn-range"
            type="range"
            min="0"
            max="1000"
            :value="seekValue"
            :style="{ '--pct': progressPct + '%' }"
            aria-label="播放进度"
            @pointerdown="seeking = true"
            @pointerup="seeking = false"
            @input="onSeekInput"
            @change="onSeekChange"
          />
          <span class="mn-time">{{ fmtDur(durTime) }}</span>
        </div>
      </div>

      <!-- 右：音量 -->
      <div class="mn-vol">
        <button class="mn-btn" :title="muted ? '取消静音' : '静音'" @click="toggleMute">
          <svg v-if="muted || volShown === 0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 9v6h4l5 4V5L8 9H4z" />
            <path d="m16 9 5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 9v6h4l5 4V5L8 9H4z" />
            <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
          </svg>
        </button>
        <input
          class="mn-range mn-range-vol"
          type="range"
          min="0"
          max="1000"
          :value="volShown * 10"
          :style="{ '--pct': volShown + '%' }"
          aria-label="音量"
          @input="onVolInput"
        />
      </div>
    </footer>

    <!--
      音频引擎。**必须留在 DOM 里** —— 组件在 disconnectedCallback 里会 audio.pause()
      并清空 src，从 DOM 移除等于停播。用 display:none 隐藏即可：display:none 的祖先会
      把整棵子树移出盒树，组件内部那个 position:fixed 的 .mp-bar 也就不会再绘制。
      它的 audio 是构造函数里 new Audio() 出来的**游离元素**（不在 shadow 内、从未挂载），
      所以隐藏 UI 完全不影响播放。

      playlist="[]" 必须保留：内联 playlist 优先级最高，组件因此**不会**自己去拉
      /m/api/v1/songs（那条链路现在是空的），也不会预取第 0 首。
      封面/音频走 song.url / song.coverUrl（后端注入的相对签名地址，本页已用 assetUrl 补上 API 基址）。
    -->
    <music-player
      v-if="scriptState === 'ready'"
      ref="player"
      class="mp-hidden"
      :playlist-url="PLAYLIST_URL"
      :stream-url="STREAM_TMPL"
      :lyric-url="LYRIC_TMPL"
      :cover-url="COVER_TMPL"
      playlist="[]"
      position="bottom"
      theme="dark"
    />

    <!--
      全屏播放页：点底部播放条展开。
      必须 Teleport —— 页面根是 position:fixed，会创建堆叠上下文，留在内部的浮层
      再怎么调 z-index 也盖不住 NavBar（同一个坑，见下面弹窗那段注释）。
    -->
    <Teleport to="body">
      <transition name="expand">
        <div v-if="expanded" class="mn-exp">
          <!-- 氛围背景：就是封面本身的模糊放大版，色调天然跟着封面走 -->
          <div
            class="mn-exp-bg"
            :style="expCover
              ? { backgroundImage: `url(${expCover})` }
              : { background: coverGradient(currentSong && currentSong.title) }"
          ></div>

          <button class="mn-exp-close" title="收起（Esc）" @click="expanded = false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          <!-- 点空白处收起（@click.self 保证点封面/歌词不会误触） -->
          <div class="mn-exp-body" @click.self="expanded = false">
            <!--
              大圆封面：播放时旋转，光晕取封面色。
              光晕走 CSS 变量而不是直接写 box-shadow —— 写死内联样式的话，
              hover 放大阴影（CSS 里的 :hover）永远盖不过它。
            -->
            <div
              class="mn-exp-cover"
              :class="{ spinning: isPlaying }"
              :style="{ '--glow': glowColor }"
            >
              <img
                v-if="expCover"
                :src="expCover"
                alt=""
                @error="(e) => (e.target.style.display = 'none')"
              />
              <span
                v-else
                class="mn-exp-cover-fallback"
                :style="{ background: coverGradient(currentSong && currentSong.title) }"
              >♪</span>
            </div>

            <!-- 右侧：有歌词显示歌词，没有就退回歌曲信息 -->
            <div class="mn-exp-side">
              <div class="mn-exp-head">
                <h2>{{ (currentSong && currentSong.title) || '未在播放' }}</h2>
                <p>
                  <span>{{ (currentSong && currentSong.artist) || '—' }}</span>
                  <template v-if="currentSong && currentSong.album">
                    <span class="mn-exp-dot">·</span>{{ currentSong.album }}
                  </template>
                </p>
              </div>

              <div v-if="lyrics.length" ref="lyricBox" class="mn-exp-lyrics">
                <p
                  v-for="(l, i) in lyrics"
                  :key="i"
                  class="mn-lyric-line"
                  :class="{ active: i === curLine }"
                  @click="seekToLyric(l)"
                >{{ l.text }}</p>
              </div>

              <div v-else class="mn-exp-info">
                <p class="mn-exp-empty">暂无歌词</p>
                <dl>
                  <div><dt>歌曲</dt><dd>{{ (currentSong && currentSong.title) || '—' }}</dd></div>
                  <div><dt>歌手</dt><dd>{{ (currentSong && currentSong.artist) || '—' }}</dd></div>
                  <div><dt>专辑</dt><dd>{{ (currentSong && currentSong.album) || '单曲' }}</dd></div>
                  <div><dt>时长</dt><dd>{{ fmtDur(currentSong && currentSong.duration) }}</dd></div>
                </dl>
              </div>

              <!--
                频谱线条 + 进度条：进度条与底部播放条共用同一套状态和函数
                （progressPct / seekValue / onSeekInput / onSeekChange），所以两处的
                拖动语义完全一致，不会出现「底部能拖、全屏拖了不回弹」这种两套行为。
                这一块放在歌词下方、按钮上方作为一个固定的「传输簇」——歌词区是
                flex:1，滚动时它和按钮都不跟着跑。
              -->
              <div class="mn-exp-bottom">
                <!-- 频谱线条：横向铺满、紧贴进度条上方，每帧由 JS 重画 -->
                <canvas class="mn-exp-viz" ref="vizEl" aria-hidden="true"></canvas>

                <div class="mn-exp-progress">
                  <span class="mn-exp-time">{{ fmtDur(curTime) }}</span>
                  <input
                    class="mn-range mn-exp-range"
                    type="range"
                    min="0"
                    max="1000"
                    :value="seekValue"
                    :style="{ '--pct': progressPct + '%' }"
                    aria-label="播放进度"
                    @pointerdown="seeking = true"
                    @pointerup="seeking = false"
                    @input="onSeekInput"
                    @change="onSeekChange"
                  />
                  <span class="mn-exp-time">{{ fmtDur(durTime) }}</span>
                </div>
              </div>

              <!-- 频谱灵敏度：由控制条右侧的按钮开关，值存 localStorage -->
              <div v-if="vizOpen" class="mn-exp-sens">
                <span class="mn-exp-sens-name">灵敏度</span>
                <input
                  class="mn-range mn-exp-sens-range"
                  type="range"
                  min="50"
                  max="200"
                  step="5"
                  :value="Math.round(vizSens * 100)"
                  :style="{ '--pct': sensPct + '%' }"
                  aria-label="频谱灵敏度"
                  @input="vizSens = $event.target.value / 100"
                />
                <span class="mn-exp-sens-val">{{ vizSens.toFixed(2) }}×</span>
                <button
                  class="mn-exp-sens-reset"
                  :disabled="vizSens === 1"
                  title="恢复默认"
                  @click="vizSens = 1"
                >重置</button>
              </div>

              <!--
                切歌 / 暂停。和底部条共用同一套函数，所以「单曲循环下点手动下一曲」
                之类的手势语义在这里也完全一致，不会出现两套行为。
                放在歌词区下方，是为了让它固定住 —— 歌词滚动时按钮不跟着跑。
              -->
              <div class="mn-exp-ctrl">
                <button class="mn-exp-btn" title="上一曲" @click="prevTrack">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM20 6v12l-9-6z" /></svg>
                </button>

                <button
                  class="mn-exp-btn mn-exp-btn-main"
                  :title="isPlaying ? '暂停' : '播放'"
                  @click="togglePlay"
                >
                  <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                  <svg v-else viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                </button>

                <button class="mn-exp-btn" title="下一曲" @click="nextTrack">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM4 6v12l9-6z" /></svg>
                </button>

                <!--
                  灵敏度开关。绝对定位钉在控制条右端 —— 走文档流的话会把
                  上一曲/播放/下一曲整体挤偏，「主操作居中」就废了。
                -->
                <button
                  class="mn-exp-tool"
                  :class="{ on: vizOpen }"
                  title="频谱灵敏度"
                  :aria-expanded="vizOpen"
                  aria-label="频谱灵敏度"
                  @click="vizOpen = !vizOpen"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
                    <circle cx="16" cy="7" r="2" />
                    <circle cx="10" cy="17" r="2" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>

    <!--
      弹窗一律 Teleport 到 body。
      ⚠️ 页面根元素是 position:fixed —— 这会**创建堆叠上下文**（即使 z-index 是 auto）。
      弹窗若留在页面内部，它们的 z-index:200 只在页面这一层里有效，整个页面被压在
      NavBar 的 z-index:100 之下，结果是遮罩盖不住顶部 76px、那一条还是亮的且能点。
      挪到 body 就回到根堆叠上下文，200 > 100 正常生效。
    -->
    <Teleport to="body">
      <!-- 扫码绑定弹窗 -->
      <transition name="fade">
        <div v-if="qr.open" class="modal-mask" @click.self="closeBind">
          <div class="modal">
            <h3>绑定酷狗账号</h3>
            <p class="modal-sub">用手机酷狗 App 扫描二维码。账号全站共用一份，绑定后所有人的曲库都来自它。</p>
            <div class="qr-box">
              <img v-if="qr.image" :src="qr.image" alt="酷狗登录二维码" />
              <span v-else class="qr-loading">正在获取二维码…</span>
              <div v-if="qr.expired" class="qr-expired">
                <p>二维码已过期</p>
                <button class="btn-kg" @click="openBind">重新获取</button>
              </div>
            </div>
            <p class="qr-status">
              {{ qr.status === 1 ? '等待扫码…' : qr.status === 2 ? '已扫描，请在手机上确认' : qr.status === 0 && qr.key ? '二维码已过期' : ' ' }}
            </p>
            <button class="btn-kg ghost" @click="closeBind">取消</button>
          </div>
        </div>
      </transition>

      <!-- 「我喜欢」认不出来时的手动选择 -->
      <transition name="fade">
        <div v-if="picker.open" class="modal-mask">
          <div class="modal">
            <h3>选择「我喜欢」歌单</h3>
            <p class="modal-sub">没能在你的歌单里认出「我喜欢」。选一个作为曲库来源吧，选完会记住。</p>
            <ul class="picker-list">
              <li v-for="p in picker.candidates" :key="p.id" @click="doSync(p.id)">
                <span class="picker-name">{{ p.name }}</span>
                <span class="picker-meta">{{ p.songCount || '?' }} 首</span>
              </li>
            </ul>
            <button class="btn-kg ghost" @click="picker.open = false">取消</button>
          </div>
        </div>
      </transition>

    </Teleport>
  </div>
</template>

<style scoped>
/*
  整页固定深色，**不跟随全站主题**（用户要求）。
  所以这里的颜色全部走本页自己的 --mn-* 变量，而不是全站的 --surface/--text —— 那些在
  亮色主题下会变成浅底深字，和网易云这套配色串味。
*/
.music-page {
  --mn-bg: #191919;
  --mn-side: #212121;
  --mn-bar: #282828;
  --mn-accent: #ec4141;
  --mn-text: #e8e8e8;
  --mn-dim: #9a9a9a;
  --mn-faint: #6a6a6a;
  --mn-line: rgba(255, 255, 255, 0.07);
  --mn-hover: rgba(255, 255, 255, 0.06);

  /* 占满 NavBar 以下的整个视口，且**脱离文档流** —— 这样 app-main 的
     padding-top:76px / padding-bottom:60px 和页脚都不会挤到它（App.vue 无需改动）。
     76px 是 NavBar 的固定高度（NavBar.vue / AdminLayout.vue 用的是同一个约定）。 */
  position: fixed;
  inset: 76px 0 0 0;
  z-index: 10; /* 低于 NavBar 的 100；弹窗已 Teleport 到 body，不受这里影响 */
  display: flex;
  background: var(--mn-bg);
  color: var(--mn-text);
  font-size: 14px;
}

/* ---------------- 侧边栏 ---------------- */
.mn-side {
  flex: 0 0 220px;
  background: var(--mn-side);
  border-right: 1px solid var(--mn-line);
  padding: 18px 0 92px; /* 底部留白，避免被播放条压住 */
  display: flex;
  flex-direction: column;
  gap: 22px;
  overflow-y: auto;
}
.mn-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
}
.mn-logo-mark {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--mn-accent);
  color: #fff;
  font-size: 16px;
}
.mn-logo-text {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.mn-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mn-nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 20px;
  border: none;
  background: transparent;
  color: var(--mn-dim);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  /* 【新增动画】背景与文字平滑过渡 */
  transition: background 0.2s ease, color 0.2s ease;
}
.mn-nav-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.mn-nav-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mn-nav-count {
  font-size: 12px;
  color: var(--mn-faint);
  font-variant-numeric: tabular-nums;
}

/*
  【新增动画】左侧红色竖线：不是「直接出现」，而是从 0 宽平滑展开。
  用 scaleX 而不是 width —— width 会触发布局重算，transform 不会。
*/
.mn-nav-line {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--mn-accent);
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 0.2s ease;
}
/* 【新增动画】hover：背景渐变加深 + 竖线展开 */
.mn-nav-item:hover {
  background: linear-gradient(90deg, rgba(236, 65, 65, 0.12), rgba(255, 255, 255, 0.04));
  color: var(--mn-text);
}
.mn-nav-item:hover .mn-nav-line {
  transform: scaleX(1);
}
.mn-nav-item.active {
  color: var(--mn-text);
  font-weight: 600;
  background: rgba(255, 255, 255, 0.05);
}
.mn-nav-item.active .mn-nav-line {
  transform: scaleX(1);
}

/* ---------------- 主内容区（唯一滚动容器） ---------------- */
.mn-main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 22px 28px 100px; /* 底部留白避开播放条 */
}
.mn-head {
  margin-bottom: 18px;
}
.mn-head-top {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}
.mn-head-title h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.mn-head-sub {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--mn-faint);
}
.mn-head-tools {
  display: flex;
  align-items: center;
  gap: 12px;
}
.mn-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border-radius: 999px;
  background: var(--mn-side);
  border: 1px solid var(--mn-line);
  transition: border-color 0.2s ease;
}
.mn-search:focus-within {
  border-color: var(--mn-accent);
}
.mn-search svg {
  width: 15px;
  height: 15px;
  color: var(--mn-faint);
  flex-shrink: 0;
}
.mn-search input {
  width: 200px;
  border: none;
  background: transparent;
  color: var(--mn-text);
  font-size: 13px;
  outline: none;
}
.mn-search input::placeholder {
  color: var(--mn-faint);
}
.mn-count {
  font-size: 12px;
  color: var(--mn-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.mn-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
}

/* ---------------- 曲目列表 ---------------- */
.mn-listhead {
  display: grid;
  grid-template-columns: 42px minmax(0, 1.6fr) minmax(0, 1fr) 60px 110px;
  gap: 16px;
  padding: 0 12px 8px;
  font-size: 12px;
  color: var(--mn-faint);
  border-bottom: 1px solid var(--mn-line);
}
.mn-listhead .col-dur {
  text-align: right;
}

.list-state {
  padding: 60px 0;
  text-align: center;
  color: var(--mn-faint);
  font-size: 14px;
}

.tracklist {
  list-style: none;
  margin: 0;
  padding: 0;
}
.track {
  display: grid;
  grid-template-columns: 42px minmax(0, 1.6fr) minmax(0, 1fr) 60px 110px;
  gap: 16px;
  align-items: center;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  /* 【新增动画】背景 0.2s 过渡 + 位移也在同一时长内完成 */
  transition: background 0.2s ease, transform 0.2s ease;
}
/* 【新增动画】hover：整行变色并轻微上移 1px */
.track:hover {
  background: var(--mn-hover);
  transform: translateY(-1px);
}
.track.locked {
  cursor: default;
}
.track.locked:hover {
  background: transparent;
  transform: none;
}

/*
  【新增动画】正在播放的行：文字标红 + 柔和呼吸。
  只动 opacity、幅度很小、周期偏慢 —— 目标是「能注意到」，不是「闪」。
  并且只作用于 .active 这一个元素，1450 行的列表里也只有一个在动。
*/
.track.active .t-title {
  color: var(--mn-accent);
}
.track.active .t-artist {
  color: rgba(236, 65, 65, 0.6);
}
.track.active .t-title,
.track.active .t-artist {
  animation: mn-breathe 2.4s ease-in-out infinite;
}
@keyframes mn-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.72; }
}

.col-idx {
  position: relative;
  display: grid;
  place-items: center;
  color: var(--mn-faint);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.idx-play {
  position: absolute;
  font-size: 11px;
  color: var(--mn-text);
  opacity: 0;
  transform: scale(0.4);
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.track:hover .idx-num { opacity: 0; }
.track:hover .idx-play { opacity: 1; transform: scale(1); }
.track.active .idx-num,
.track.active .idx-play { display: none; }
.idx-lock { font-size: 13px; opacity: 0.5; }

.eq {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 12px;
}
.eq i {
  width: 3px;
  border-radius: 1px;
  background: var(--mn-accent);
  animation: eqbar 0.9s ease-in-out infinite;
}
.eq i:nth-child(1) { height: 6px; }
.eq i:nth-child(2) { height: 12px; animation-delay: 0.15s; }
.eq i:nth-child(3) { height: 8px; animation-delay: 0.3s; }
@keyframes eqbar { 0%, 100% { transform: scaleY(0.6); } 50% { transform: scaleY(1); } }

.col-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.t-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--mn-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.t-artist {
  font-size: 12px;
  color: var(--mn-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.col-album {
  min-width: 0;
  color: var(--mn-faint);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.col-dur {
  text-align: right;
  color: var(--mn-faint);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.col-action {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.btn-playnext {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  border: 1px solid var(--mn-line);
  color: var(--mn-dim);
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.2s ease, border-color 0.15s ease, color 0.15s ease;
}
.btn-playnext svg { width: 12px; height: 12px; }
/*
  【新增动画】hover 抬升时才露出「下一首」，平时保持列表干净。
  只在真的支持 hover 的设备上藏 —— 触摸屏没有 hover，若一并藏掉，
  这个按钮就永远点不到了。
*/
@media (hover: hover) {
  .btn-playnext { opacity: 0; }
  .track:hover .btn-playnext { opacity: 1; }
}
.btn-playnext:hover { border-color: var(--mn-accent); color: var(--mn-accent); }
.btn-playnext.nexted {
  opacity: 1;
  border-color: var(--mn-accent);
  color: var(--mn-accent);
  background: rgba(236, 65, 65, 0.12);
}
.locked-tag {
  padding: 3px 10px;
  font-size: 11px;
  border-radius: 999px;
  border: 1px dashed var(--mn-line);
  color: var(--mn-faint);
  white-space: nowrap;
}

.player-error {
  padding: 18px;
  text-align: center;
  color: var(--mn-accent);
  font-size: 14px;
  border: 1px dashed var(--mn-line);
  border-radius: 8px;
}

/* ---------------- 底部播放条 ---------------- */
.mn-player {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 80px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 0 24px;
  background: var(--mn-bar);
  border-top: 1px solid var(--mn-line);
}

/* 左：封面 + 信息 */
.mn-now {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 260px;
  flex-shrink: 0;
}
.mn-cover {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  background: #333;
  /* 【新增动画】播放中 6 秒一圈 */
  animation: mn-spin 6s linear infinite;
  /* 默认冻结：暂停时停住，且**保留当前角度** */
  animation-play-state: paused;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
  transition: box-shadow 0.3s ease;
}
.mn-cover.spinning {
  animation-play-state: running;
}
/* 【新增动画】hover 时阴影放大 */
.mn-cover:hover {
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.62);
}
@keyframes mn-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.mn-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mn-cover-fallback {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.85);
  font-size: 20px;
}
.mn-now-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mn-now-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mn-now-artist {
  font-size: 12px;
  color: var(--mn-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 中：控制按钮 + 进度 */
.mn-ctrl {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.mn-btns {
  display: flex;
  align-items: center;
  gap: 16px;
}
.mn-btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--mn-text);
  cursor: pointer;
  /* 【新增动画】只动 transform，保证性能 */
  transition: transform 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.mn-btn svg { width: 18px; height: 18px; }
/* 【新增动画】hover 放大、按下缩小 */
.mn-btn:hover {
  transform: scale(1.1);
  color: var(--mn-accent);
}
.mn-btn:active {
  transform: scale(0.92);
}
.mn-btn-main {
  width: 38px;
  height: 38px;
  background: var(--mn-accent);
  color: #fff;
}
.mn-btn-main svg { width: 20px; height: 20px; }
.mn-btn-main:hover {
  color: #fff;
  background: #f05252;
}

.mn-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 560px;
}
.mn-time {
  font-size: 11px;
  color: var(--mn-faint);
  font-variant-numeric: tabular-nums;
  width: 34px;
  text-align: center;
  flex-shrink: 0;
}

/* ---------------- 进度条 / 音量条（自绘 range） ---------------- */
.mn-range {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  min-width: 0;
  height: 4px;
  border-radius: 2px;
  cursor: pointer;
  outline: none;
  /* 已播部分用红色填充：百分比来自绑定在元素上的 --pct（由 rAF 每帧刷新）。
     这里**故意不加 transition** —— 每帧都是新值，加过渡反而会互相追赶。 */
  background: linear-gradient(
    to right,
    var(--mn-accent) 0%,
    var(--mn-accent) var(--pct, 0%),
    rgba(255, 255, 255, 0.18) var(--pct, 0%),
    rgba(255, 255, 255, 0.18) 100%
  );
}
.mn-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  border: none;
  /* 【新增动画】滑块 hover 放大 */
  transition: transform 0.15s ease;
}
.mn-range:hover::-webkit-slider-thumb {
  transform: scale(1.3);
}
.mn-range::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: none;
  border-radius: 50%;
  background: #fff;
}
.mn-vol {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 150px;
  flex-shrink: 0;
}
.mn-range-vol {
  flex: 1;
}

/* ---------------- 弹窗 ---------------- */
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  /*
    ⚠️ 弹窗全都 Teleport 到了 body，**不再是 .music-page 的后代** ——
    所以拿不到定义在 .music-page 上的 --mn-* 变量。里面的 .btn-kg 用了
    var(--mn-accent)，变量缺失时该声明会在计算值阶段失效（背景变透明、
    边框变 currentColor），主按钮会退化成一根灰描边。
    在这里重新声明一份，是给整个弹窗子树兜住的唯一地方（.modal 也可以，
    但遮罩是所有弹窗的共同祖先，放这里覆盖面最广）。
  */
  --mn-accent: #ec4141;
  --mn-text: #e8e8e8;
  --mn-dim: #9a9a9a;
  --mn-faint: #6a6a6a;
  --mn-line: rgba(255, 255, 255, 0.07);
}
.modal {
  width: min(380px, calc(100vw - 40px));
  padding: 26px 24px 20px;
  border-radius: 18px;
  background: #1c1c1e;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 30px 70px rgba(0, 0, 0, 0.45);
  text-align: center;
  color: #e8e8e8;
}
.modal h3 { margin: 0 0 8px; font-size: 17px; font-weight: 800; }
.modal-sub { margin: 0 0 16px; font-size: 12px; line-height: 1.7; color: #9a9a9a; }
.qr-box {
  position: relative;
  width: 208px;
  height: 208px;
  margin: 0 auto 12px;
  display: grid;
  place-items: center;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
}
.qr-box img { width: 100%; height: 100%; object-fit: contain; }
.qr-loading { font-size: 12px; color: #666; }
.qr-expired {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  gap: 10px;
  background: rgba(255, 255, 255, 0.94);
  color: #333;
  font-size: 13px;
}
.qr-expired p { margin: 0; }
.qr-status { min-height: 20px; margin: 0 0 16px; font-size: 12px; color: #9a9a9a; }
.picker-list { list-style: none; margin: 0 0 16px; padding: 0; max-height: 260px; overflow-y: auto; }
.picker-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}
.picker-list li:hover { background: rgba(255, 255, 255, 0.06); }
.picker-name { font-size: 14px; font-weight: 600; }
.picker-meta { font-size: 12px; color: #6a6a6a; }

/* ---------------- 按钮 ---------------- */
.btn-kg {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 999px;
  border: 1px solid var(--mn-accent);
  background: var(--mn-accent);
  color: #fff;
  cursor: pointer;
  white-space: nowrap;
  /* 【新增动画】hover 轻微放大，按下回缩 */
  transition: transform 0.15s ease, filter 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.btn-kg:hover:not(:disabled) { filter: brightness(1.1); transform: scale(1.04); }
.btn-kg:active:not(:disabled) { transform: scale(0.96); }
.btn-kg:disabled { opacity: 0.55; cursor: default; }
.btn-kg.ghost { background: transparent; color: var(--mn-dim); border-color: rgba(255, 255, 255, 0.18); }
.btn-kg.ghost:hover:not(:disabled) { border-color: var(--mn-accent); color: var(--mn-accent); }

/* 下载中的实时进度：呼吸一下，和静态文案区分开 */
.dl-live { color: var(--mn-accent); font-weight: 700; animation: dl-pulse 1.6s ease-in-out infinite; }
@keyframes dl-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }

/* ---------------- 全屏播放页 ---------------- */
/*
  ⚠️ 这个浮层被 Teleport 到了 body，**已经不在 .music-page 子树里**，
  拿不到那边定义的 --mn-* 变量，所以这里必须把整套变量重新声明一遍。
  （同理，它的 z-index 是相对根堆叠上下文的：150 盖过 NavBar(100)，低于弹窗(200)。）
*/
.mn-exp {
  --mn-bg: #191919;
  --mn-accent: #ec4141;
  --mn-text: #e8e8e8;
  --mn-dim: #9a9a9a;
  --mn-faint: #6a6a6a;
  --mn-line: rgba(255, 255, 255, 0.07);

  position: fixed;
  inset: 0;
  z-index: 150;
  overflow: hidden;
  background: #0f0f0f;
  color: var(--mn-text);
}

/* 氛围背景：封面本身的模糊放大版，色调天然跟着封面走 */
.mn-exp-bg {
  position: absolute;
  /* 往外溢 10% + 放大，避免模糊后在四边露出没铺满的底色 */
  inset: -10%;
  background-position: center;
  background-size: cover;
  filter: blur(70px) saturate(1.3);
  opacity: 0.4;
  transform: scale(1.1);
  /* 它只是背景板，别把点击从 .mn-exp-body 那里截走 */
  pointer-events: none;
}

/* 点空白处收起的判定区：@click.self 只认它自己，点封面/歌词不会误触 */
.mn-exp-body {
  position: relative;
  z-index: 1;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: clamp(40px, 7vw, 110px);
  padding: 80px clamp(32px, 6vw, 96px);
}

/* 右上角收起按钮 */
.mn-exp-close {
  position: absolute;
  top: 24px;
  right: 28px;
  z-index: 2;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.35);
  color: var(--mn-dim);
  cursor: pointer;
  /* 【新增动画】hover 放大、按下回缩 */
  transition: transform 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.mn-exp-close svg { width: 18px; height: 18px; }
.mn-exp-close:hover { color: #fff; border-color: rgba(255, 255, 255, 0.4); transform: scale(1.1); }
.mn-exp-close:active { transform: scale(0.92); }

/* 大圆封面 */
.mn-exp-cover {
  width: clamp(220px, 28vw, 380px);
  height: clamp(220px, 28vw, 380px);
  flex-shrink: 0;
  border-radius: 50%;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: #2a2a2a;
  /* 【新增动画】复用底部条的 mn-spin（6 秒一圈） */
  animation: mn-spin 6s linear infinite;
  /* 暂停时冻结且**保留当前角度**（移除 animation 会把角度重置回 0°，封面会跳一下） */
  animation-play-state: paused;
  /* 光晕由内联的 --glow（封面主色）驱动；hover 时放大 */
  box-shadow: 0 0 90px 24px var(--glow, rgba(255, 255, 255, 0.16));
  /* 只有这一个元素值得占图层 —— 列表那样上千行挂 will-change 会炸内存 */
  will-change: transform;
}
.mn-exp-cover.spinning { animation-play-state: running; }
/* 【新增动画】hover 让光晕扩散开。刻意不加 transition：
   这么大面积的 box-shadow 做过渡，每一帧都要重绘整块模糊，得不偿失 */
.mn-exp-cover:hover {
  box-shadow: 0 0 140px 40px var(--glow, rgba(255, 255, 255, 0.24));
}
.mn-exp-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  /* 图片可拖动的话，鼠标一拖就变成半透明的拖拽预览，很出戏 */
  -webkit-user-drag: none;
  user-select: none;
}
.mn-exp-cover-fallback {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  font-size: 72px;
  color: rgba(255, 255, 255, 0.85);
}

/* 右：歌词 / 歌曲信息 */
.mn-exp-side {
  flex: 1;
  min-width: 0;
  max-width: 560px;
  height: min(64vh, 560px);
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.mn-exp-head h2 {
  margin: 0 0 10px;
  font-size: 26px;
  font-weight: 800;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.mn-exp-head p {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--mn-dim);
}
.mn-exp-dot { opacity: 0.6; }

/* 歌词列表 */
.mn-exp-lyrics {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 40px 0;
  /*
    必须是定位元素：scrollToActive() 靠 el.offsetTop 算居中位置，
    而 offsetTop 是相对**最近的定位祖先**的。少了这一行，定位祖先会一路找到
    .mn-exp-body，把标题区的高度也算进来，每行都会多滚一截。
  */
  position: relative;
  /* 藏掉滚动条，只留内容 */
  scrollbar-width: none;
  /* 上下缘渐隐，让两端歌词化开，视线自然落在当前行 */
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 12%, #000 84%, transparent);
  mask-image: linear-gradient(to bottom, transparent, #000 12%, #000 84%, transparent);
}
.mn-exp-lyrics::-webkit-scrollbar { display: none; }

.mn-lyric-line {
  margin: 0;
  padding: 7px 0;
  font-size: 15px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.42);
  /* 点击跳转进度：可点区域给出手型光标 */
  cursor: pointer;
  /* 【新增动画】切行时颜色平滑过渡。
     刻意**不动 font-size** —— 行高变了会让整个列表重排、滚动位置跟着抖 */
  transition: color 0.3s ease, font-weight 0.3s ease;
}
/* 悬停提示可点（排除当前句，避免和高亮色打架） */
.mn-lyric-line:not(.active):hover {
  color: rgba(255, 255, 255, 0.78);
}
.mn-lyric-line.active {
  color: #fff;
  font-weight: 700;
}

/* 无歌词时的回退：歌曲信息 */
.mn-exp-info {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
}
.mn-exp-info::-webkit-scrollbar { display: none; }
.mn-exp-empty {
  margin: 0 0 18px;
  font-size: 13px;
  color: var(--mn-faint);
}
.mn-exp-info dl { margin: 0; }
.mn-exp-info dl > div {
  display: flex;
  gap: 14px;
  padding: 11px 0;
  border-bottom: 1px solid var(--mn-line);
  font-size: 14px;
}
.mn-exp-info dt { flex: 0 0 48px; color: var(--mn-faint); }
.mn-exp-info dd {
  margin: 0;
  min-width: 0;
  color: var(--mn-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 频谱线条 + 进度条：整体作为一个「传输簇」固定在歌词下方 */
.mn-exp-bottom {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  flex-shrink: 0;
}
/*
  频谱线条：横向铺满、紧贴进度条上方的一排竖线，长度由真实频谱逐帧驱动。
  用 canvas 而不是 64 个 div —— 每帧要更新 64 个长度，DOM 方案得写 64 个
  CSS 变量再让样式系统重算，canvas 一次 clearRect + 一条 path 就画完。
  高度就是线条的最大长度（线从底边往上长）。
*/
.mn-exp-viz {
  display: block;   /* canvas 默认 inline，会多出一条基线间隙 */
  width: 100%;
  height: 42px;
  pointer-events: none;
}

/* 全屏页进度条：直接复用 .mn-range（渐变填充 + --pct 都由 JS 驱动），
   只把时间字号和触控热区按全屏页的空间重新调一下 */
.mn-exp-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  flex-shrink: 0;
}
.mn-exp-time {
  font-size: 11px;
  color: var(--mn-faint);
  font-variant-numeric: tabular-nums;
  width: 38px;
  text-align: center;
  flex-shrink: 0;
}
/* 全屏页比底部条宽敞，条和滑块都放大一点，手指好按 */
.mn-exp-range { height: 5px; border-radius: 3px; }
.mn-exp-range::-webkit-slider-thumb { width: 14px; height: 14px; }
.mn-exp-range::-moz-range-thumb { width: 14px; height: 14px; }

/* 歌词区下方的控制条：切歌 / 暂停 */
.mn-exp-ctrl {
  position: relative;   /* 右侧灵敏度按钮的定位锚点，见 .mn-exp-tool */
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 28px;
  flex-shrink: 0;
}
.mn-exp-btn {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--mn-text);
  cursor: pointer;
  /* 【新增动画】hover 放大、按下回缩（与底部条按钮同一套手感） */
  transition: transform 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.mn-exp-btn svg { width: 22px; height: 22px; }
.mn-exp-btn:hover { color: #fff; transform: scale(1.1); }
.mn-exp-btn:active { transform: scale(0.92); }
/* 播放/暂停是主操作，给个实心红底 */
.mn-exp-btn-main {
  width: 56px;
  height: 56px;
  background: var(--mn-accent);
  color: #fff;
}
.mn-exp-btn-main svg { width: 26px; height: 26px; }
.mn-exp-btn-main:hover { background: #f05252; color: #fff; }

/* 控制条右端的辅助按钮（灵敏度开关）：绝对定位，不参与居中 */
.mn-exp-tool {
  position: absolute;
  right: 0;
  top: 50%;
  /* 不能用 .mn-exp-btn 那套 hover:scale —— 会覆盖掉这里的 translateY */
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--mn-faint);
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}
.mn-exp-tool svg { width: 19px; height: 19px; }
.mn-exp-tool:hover { color: #fff; background: rgba(255, 255, 255, 0.1); }
.mn-exp-tool.on { color: var(--mn-accent); }
.mn-exp-tool:focus-visible { outline: 2px solid var(--mn-accent); outline-offset: 2px; }

/* 灵敏度面板：夹在进度条与控制条之间 */
.mn-exp-sens {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  flex-shrink: 0;
  padding-top: 2px;
}
.mn-exp-sens-name {
  font-size: 12px;
  color: var(--mn-faint);
  flex-shrink: 0;
}
.mn-exp-sens-range { height: 4px; }
.mn-exp-sens-range::-webkit-slider-thumb { width: 12px; height: 12px; }
.mn-exp-sens-range::-moz-range-thumb { width: 12px; height: 12px; }
.mn-exp-sens-val {
  font-size: 11px;
  color: var(--mn-faint);
  font-variant-numeric: tabular-nums;
  width: 38px;
  text-align: right;
  flex-shrink: 0;
}
.mn-exp-sens-reset {
  flex-shrink: 0;
  padding: 3px 9px;
  font-size: 11px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  color: var(--mn-faint);
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}
.mn-exp-sens-reset:hover:not(:disabled) { color: #fff; background: rgba(255, 255, 255, 0.16); }
.mn-exp-sens-reset:disabled { opacity: 0.35; cursor: default; }

/* 【新增动画】进场：整块面板从视口下方滑上来 */
.expand-enter-active,
.expand-leave-active {
  transition: transform 0.36s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.36s ease;
}
.expand-enter-from,
.expand-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

/* 底部条左侧整块可点（展开播放页） */
.mn-now {
  cursor: pointer;
}
.mn-now:focus-visible {
  outline: 2px solid var(--mn-accent);
  outline-offset: 3px;
  border-radius: 8px;
}
/* 【新增动画】hover 时上浮的提示箭头 */
.mn-expand-ico {
  width: 16px;
  height: 16px;
  margin-left: auto;
  flex-shrink: 0;
  color: var(--mn-faint);
  transition: transform 0.2s ease, color 0.2s ease;
}
.mn-now:hover .mn-expand-ico {
  color: var(--mn-text);
  transform: translateY(-2px);
}

/* ---------------- 隐藏的音频引擎 ---------------- */
.mp-hidden {
  display: none;
}

/* ---------------- 过渡 ---------------- */
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ---------------- 响应式 ---------------- */
@media (max-width: 900px) {
  .mn-side { flex-basis: 64px; }
  .mn-logo-text, .mn-nav-label, .mn-nav-count { display: none; }
  .mn-nav-item { justify-content: center; padding: 12px 0; }
  .mn-now { width: 180px; }
  .mn-vol { width: 110px; }
  /* 全屏播放页：窄屏改纵向堆叠，封面在上、歌词在下 */
  .mn-exp-body {
    flex-direction: column;
    justify-content: flex-start;
    gap: 26px;
    padding: 70px 24px 32px;
  }
  .mn-exp-cover {
    width: min(50vw, 220px);
    height: min(50vw, 220px);
  }
  .mn-exp-side {
    width: 100%;
    max-width: none;
    height: auto;
    flex: 1;
    min-height: 0;
    text-align: center;
  }
  .mn-exp-head p { justify-content: center; }
  .mn-exp-head h2 { font-size: 21px; }
  .mn-exp-head p { font-size: 12px; }
}
@media (max-width: 680px) {
  .mn-main { padding: 16px 14px 100px; }
  .track, .mn-listhead { grid-template-columns: 34px minmax(0, 1fr) 50px 40px; gap: 10px; }
  .col-album { display: none; }
  .col-action { display: none; }
  .mn-now { width: auto; }
  .mn-now-meta { display: none; }
}

/* ---------------- 无障碍：系统关闭动画时停用本页全部动效 ---------------- */
/*
  全局的 prefers-reduced-motion 块（main.css）只列了它自己的选择器，覆盖不到本页新增的类，
  所以这里必须自带一份。
*/
@media (prefers-reduced-motion: reduce) {
  .mn-cover,
  .mn-exp-cover,
  .mn-nav-item,
  .mn-nav-line,
  .mn-btn,
  .btn-kg,
  .btn-playnext,
  .mn-range::-webkit-slider-thumb,
  .mn-expand-ico,
  .mn-exp-close,
  .mn-exp-btn,
  .mn-lyric-line,
  .track,
  .track.active .t-title,
  .track.active .t-artist,
  .eq i,
  .dl-live {
    animation: none !important;
    transition: none !important;
  }
  .track:hover { transform: none; }
  .mn-btn:hover, .mn-btn:active { transform: none; }
  .mn-exp-close:hover, .mn-exp-close:active { transform: none; }
  /* 频谱线条不在这里处理：canvas 上没有任何 CSS 动效可降级，
     reduced-motion 时由 JS 直接不启动 rAF、不绘制（见 REDUCED_MOTION） */
  .mn-exp-btn:hover, .mn-exp-btn:active { transform: none; }
  .mn-now:hover .mn-expand-ico { transform: none; }
  /* 面板直接出现，不做滑入 */
  .expand-enter-active, .expand-leave-active { transition: none; }
}
</style>
