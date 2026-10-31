<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { videoApi, adminApi, formatDuration } from '../api'
import { probeVideoFile, putToSignedUrl } from '../lib/upload'

// 批量上传：一次选多个视频，逐个上传（复用单文件后端端点，
// 保留 magic-bytes 校验与逐文件进度/失败隔离）
// 队列项：{ uid, file?, path?, name, size, status, progress, loaded, error, videoId }
//   file 通道用 file；服务器路径通道用 path（path 模式下没有浏览器 File 对象）
const queue = ref([])
// 上传通道：'file' = 浏览器选文件；'path' = 直接填服务器本机路径（仅管理员）
const mode = ref('file')

// ---------- 存储模式（由后端 /api/video/upload-mode 决定） ----------
// 'loading' | 'cos' | 'local'
//   cos   = 线上：后端签发预签名地址，浏览器把文件直传 COS，绕开 Vercel 函数 4.5MB 体限
//   local = 本地开发：沿用 multipart 传给后端，后端落盘到 server/uploads
const storageMode = ref('loading')
const maxVideoSize = ref(0) // 后端限制（字节）；0 = 未知，不做前端预检
const isCos = computed(() => storageMode.value === 'cos')

const pathInput = ref('')
const moveSource = ref(false) // 导入后删除原文件（仅 path 模式，默认只复制）
const importRoots = ref([]) // 后端 IMPORT_ALLOWED_DIRS 白名单，用于提示与开关
const rootsLoaded = ref(false)
const category = ref('生活')
const titlePrefix = ref('')
const coverUrl = ref('')
const description = ref('')
const dragging = ref(false)
const uploading = ref(false)
const collections = ref([]) // 可选：所属合集
const collectionId = ref(null)
const startEpisode = ref(1)
// 上传页内联新建合集
const createDialog = ref(false)
const creating = ref(false)
const newCol = ref({ title: '', description: '', cover_url: '' })

const categories = ['生活', '游戏', '科技', '音乐', '影视', '动画', '学习', '搞笑', '运动', '其他']
const VIDEO_RE = /\.(mp4|webm|mkv|mov|ogg|avi|ts|flv)$/i

const stem = (name) => name.replace(/\.[^.]+$/, '') || '未命名视频'
const finalTitle = (item) => (titlePrefix.value ? `${titlePrefix.value}·${stem(item.name)}` : stem(item.name))

// 取路径最后一段：Windows 的 E:\a\b.mp4 和 POSIX 的 /a/b.mp4 都要能认
const basename = (p) => String(p).trim().split(/[\\/]/).filter(Boolean).pop() || String(p).trim()

function fmtSize(b) {
  if (!b) return '0 B'
  const mb = b / 1024 / 1024
  return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb.toFixed(1) + ' MB'
}
// path 模式下前端拿不到文件大小，显示占位符而不是「0 B」
const sizeText = (item) => (item.size ? fmtSize(item.size) : '—')

const totalBytes = computed(() => queue.value.reduce((s, i) => s + (i.size || 0), 0))
const loadedBytes = computed(() => queue.value.reduce((s, i) => s + (i.loaded || 0), 0))
// file 模式按字节算进度；path 模式拿不到字节，改用「已完成条数」表态
const overallPercent = computed(() => {
  if (mode.value === 'path') {
    const total = queue.value.length
    if (!total) return 0
    const finished = queue.value.filter((i) => i.status === 'done' || i.status === 'failed').length
    return Math.round((finished / total) * 100)
  }
  return totalBytes.value ? Math.round((loadedBytes.value / totalBytes.value) * 100) : 0
})
const pendingCount = computed(() => queue.value.filter((i) => i.status === 'pending' || i.status === 'failed').length)
const doneCount = computed(() => queue.value.filter((i) => i.status === 'done').length)
const failCount = computed(() => queue.value.filter((i) => i.status === 'failed').length)

function addFiles(list) {
  let added = 0
  let rejected = 0
  let oversize = 0
  for (const f of list) {
    if (!/video\//.test(f.type) && !VIDEO_RE.test(f.name)) {
      rejected++
      continue
    }
    // 后端限制（COS 模式是桶的单次 PUT 上限，local 模式是 multipart 上限）。
    // 前端先挡一道，省得传了 2GB 才被 413 打回来。
    if (maxVideoSize.value && f.size > maxVideoSize.value) {
      oversize++
      continue
    }
    queue.value.push({
      uid: `${Date.now()}-${added}-${f.name}`,
      file: f,
      name: f.name,
      size: f.size,
      status: 'pending',
      progress: 0,
      loaded: 0,
      error: '',
      videoId: null,
      // 浏览器端探到的元信息（时长 / 抽帧封面），由 probeItem 异步填充
      duration: 0,
      coverBlob: null,
      metaState: 'idle',
      metaPromise: null,
      // COS 直传已经拿到的 key：重试时跳过已完成的那一步，避免重传整部片子
      cosKey: '',
      coverKey: '',
      coverError: '',
    })
    // ⚠️ 必须取回数组里那个**响应式代理**再改：直接改 push 进去的原始对象不会触发视图更新
    probeItem(queue.value[queue.value.length - 1])
    added++
  }
  if (rejected) ElMessage.warning(`${rejected} 个文件不是视频格式，已忽略`)
  if (oversize) {
    ElMessage.warning(
      `${oversize} 个文件超过 ${fmtSize(maxVideoSize.value)} 的大小上限，已忽略`,
    )
  }
  if (!added && !rejected && !oversize) ElMessage.warning('请选择视频文件（mp4/webm/mkv/mov/ogg/avi 等）')
}

/**
 * 读时长 + 抽一帧封面。
 *
 * 全是「尽力而为」：mkv/avi 这类浏览器解不了码的容器会拿不到时长和封面，
 * 但**绝不能因此挡住上传** —— 时长允许为 0，封面没有也能入库。
 */
function probeItem(item) {
  if (!item.file || item.metaPromise) return item.metaPromise
  item.metaState = 'probing'
  item.metaPromise = probeVideoFile(item.file)
    .then(({ duration, cover }) => {
      item.duration = duration || 0
      item.coverBlob = cover || null
    })
    .catch(() => {
      /* 读不出来就当没有 */
    })
    .finally(() => {
      item.metaState = 'ready'
    })
  return item.metaPromise
}
function onPick(e) {
  addFiles(e.target.files || [])
  e.target.value = '' // 允许重复选同一文件
}
function onDrop(e) {
  dragging.value = false
  addFiles(e.dataTransfer.files || [])
}
function pickFile() {
  document.getElementById('video-file-input').click()
}

// path 模式：把多行路径解析成队列项（每行一个，天然支持批量）。
// 这里只做轻量去重与空行过滤，扩展名/是否在白名单内一律以后端为准。
function addPaths() {
  const lines = pathInput.value
    .split('\n')
    .map((s) => s.trim().replace(/^"(.*)"$/, '$1').trim()) // 剥掉「复制为路径」带的引号
    .filter(Boolean)
  if (!lines.length) return ElMessage.warning('请先填写要导入的文件路径')

  const existing = new Set(queue.value.filter((i) => i.path).map((i) => i.path))
  let added = 0
  let dup = 0
  for (const p of lines) {
    if (existing.has(p)) {
      dup++
      continue
    }
    existing.add(p)
    queue.value.push({
      uid: `${Date.now()}-${added}-${p}`,
      path: p,
      name: basename(p),
      size: 0, // 前端拿不到服务器上的文件大小
      status: 'pending',
      progress: 0,
      loaded: 0,
      error: '',
      videoId: null,
    })
    added++
  }
  if (added) pathInput.value = ''
  if (dup) ElMessage.warning(`${dup} 个路径已在列表中，已跳过`)
  if (!added && !dup) ElMessage.warning('没有可加入的路径')
}

// 切换通道：两种来源的队列项结构不同，不允许混在同一个列表里。
// 有未处理项时先让用户处理掉；只有已完成项则直接清空（它们已经发布出去了）。
function switchMode(next) {
  if (next === mode.value) return
  if (uploading.value) return ElMessage.warning('正在处理中，请等完成后再切换')
  if (queue.value.some((i) => i.status !== 'done')) {
    return ElMessage.warning('列表里还有未处理的项，请先处理或移除它们')
  }
  queue.value = []
  mode.value = next
}
function removeItem(item) {
  if (item.status === 'uploading') return
  queue.value = queue.value.filter((i) => i.uid !== item.uid)
}
function clearFinished() {
  if (uploading.value) return
  queue.value = queue.value.filter((i) => i.status === 'pending' || i.status === 'failed')
}

/** 本地磁盘模式：multipart 传给后端，后端落盘 + 自己抽帧/探测时长 */
async function localUpload(item) {
  const fd = new FormData()
  fd.append('video', item.file)
  fd.append('title', finalTitle(item).slice(0, 80))
  fd.append('description', description.value)
  fd.append('category', category.value)
  fd.append('cover_url', coverUrl.value.trim())
  // 浏览器读到的时长一起带上（后端能 ffprobe 就以它为准，读不到时这个就是唯一来源）
  fd.append('duration', String(item.duration || 0))
  // 合集归属在 start() 里预先打好，重试时沿用，避免下标漂移
  if (item.collectionId) {
    fd.append('collection_id', String(item.collectionId))
    fd.append('episode', String(item.episode || 1))
  }
  const { video } = await videoApi.upload(fd, (e) => {
    if (e.total) {
      item.progress = Math.min(100, Math.round((e.loaded / e.total) * 100))
      item.loaded = e.loaded
    }
  })
  item.videoId = video.id
}

/**
 * COS 直传：presign → PUT 视频 → [presign → PUT 封面] → confirm 入库。
 *
 * 三个必须守住的点：
 *   - PUT 走的是 `putToSignedUrl`（裸 XHR）：**不能**经过带 Authorization 的 api 实例，
 *     预签名地址本身已含鉴权，多一个 Bearer 头就是 403。
 *   - 已拿到的 key 记在 item 上，重试时跳过已完成的那一步。否则 confirm 失败要重传
 *     整部片子 —— 那比「不重试」还糟。
 *   - 封面失败**不阻塞入库**：视频都传上去了，为一个封面让用户重传是本末倒置。
 */
async function cosUpload(item) {
  // 等元信息读完（读时长/抽帧有超时兜底，最多十几秒）
  if (item.metaPromise) await item.metaPromise
  const title = finalTitle(item).slice(0, 80)

  // 1) 视频本体
  if (!item.cosKey) {
    const p = await videoApi.presign({ filename: item.file.name, kind: 'video' })
    await putToSignedUrl(p.url, item.file, {
      // 预签名没把 Content-Type 签进去，这里可以自由给；给了才能让 CDN 按视频类型返回，
      // <video> 才不会把它当附件下载
      contentType: item.file.type || 'application/octet-stream',
      onProgress: (e) => {
        // 视频占 0–92%，剩下留给封面和入库确认
        item.progress = Math.min(92, Math.round((e.loaded / e.total) * 92))
        item.loaded = e.loaded
      },
    })
    item.cosKey = p.key
  }

  // 2) 封面（可选）
  if (item.coverBlob && !item.coverKey) {
    try {
      const coverName = `${stem(item.name) || 'cover'}.jpg`
      const cp = await videoApi.presign({ filename: coverName, kind: 'cover' })
      await putToSignedUrl(cp.url, item.coverBlob, {
        contentType: 'image/jpeg',
        onProgress: (e) => {
          item.progress = Math.min(98, 92 + Math.round((e.loaded / e.total) * 6))
        },
      })
      item.coverKey = cp.key
    } catch (e) {
      item.coverError = e.message || '封面上传失败'
      console.warn('[upload] 封面直传失败，将不带封面入库:', e)
    }
  }

  // 3) 入库
  item.progress = 99
  item.loaded = item.size || item.file.size || 0
  const { video } = await videoApi.confirm({
    key: item.cosKey,
    title,
    description: description.value,
    category: category.value,
    cover_key: item.coverKey || undefined,
    duration: item.duration || 0,
    collection_id: item.collectionId || undefined,
    episode: item.collectionId ? item.episode || 1 : undefined,
  })
  item.videoId = video.id
  if (item.coverError) {
    ElMessage.warning(`「${title}」已发布，但封面没传上去：${item.coverError}`)
  }
}

/** 分派上传：COS 直传 or 本地 multipart（path 模式另有 importOne） */
async function uploadOne(item) {
  item.status = 'uploading'
  item.progress = 0
  item.loaded = 0
  item.error = ''
  try {
    if (isCos.value) await cosUpload(item)
    else await localUpload(item)
    item.status = 'done'
    item.progress = 100
    return true
  } catch (err) {
    item.status = 'failed'
    // 失败时保留 cosKey/coverKey：重试会接着上次的进度走
    item.error = err.message || '上传失败'
    return false
  }
}

// 服务器路径导入：后端负责复制到 uploads + 抽帧封面 + 探测时长，前端只递路径与元信息。
// 没有字节级进度（拷贝发生在服务端），所以只做「进行中」态。
async function importOne(item) {
  item.status = 'uploading'
  item.error = ''
  try {
    const { video } = await videoApi.importLocal({
      path: item.path,
      title: finalTitle(item).slice(0, 80),
      description: description.value,
      category: category.value,
      cover_url: coverUrl.value.trim(),
      collection_id: item.collectionId || undefined,
      episode: item.episode || undefined,
      move: moveSource.value,
    })
    item.status = 'done'
    item.progress = 100
    item.videoId = video.id
    return true
  } catch (err) {
    item.status = 'failed'
    item.error = err.message || '导入失败'
    return false
  }
}

// 按队列项来源分派：有 path 走服务器导入，否则走浏览器上传（COS 直传 or 本地 multipart）
const runOne = (item) => (item.path ? importOne(item) : uploadOne(item))

async function start() {
  const targets = queue.value.filter((i) => i.status === 'pending' || i.status === 'failed')
  if (!targets.length) {
    return ElMessage.warning(mode.value === 'path' ? '请先加入要导入的路径' : '请先添加视频文件')
  }
  // 先给目标批量打上合集归属（集数从起始值递增），重试仍沿用本次编号
  if (collectionId.value) {
    let ep = Math.max(1, parseInt(startEpisode.value) || 1)
    for (const item of targets) {
      item.collectionId = Number(collectionId.value)
      item.episode = ep
      ep += 1
    }
  }
  uploading.value = true
  let ok = 0
  let bad = 0
  for (const item of targets) {
    const success = await runOne(item)
    if (success) ok++
    else bad++
  }
  uploading.value = false
  const verb = mode.value === 'path' ? '导入' : '上传'
  if (bad) ElMessage.warning(`完成：${ok} 个成功，${bad} 个失败，失败的可以单独重试`)
  else ElMessage.success(`全部 ${ok} 个视频${verb}成功！`)
}

async function retryOne(item) {
  if (uploading.value) return
  uploading.value = true
  const success = await runOne(item)
  uploading.value = false
  if (success) ElMessage.success(item.path ? '导入成功' : '上传成功')
  else ElMessage.error(item.error)
}

async function loadCollections() {
  try {
    const d = await adminApi.collections()
    collections.value = d.list
  } catch {}
}

/**
 * 问后端走哪种上传方式。
 *   cos   = 线上：后端签预签名地址，浏览器把文件直传 COS（绕开 Vercel 函数 4.5MB 体限）
 *   local = 本地开发：multipart 传给后端，落盘到 server/uploads
 * 拿不到就按 local 处理：本地开发没有这个接口也照常能用，真出错会在上传那步给出可读错误。
 */
async function loadUploadMode() {
  try {
    const d = await videoApi.uploadMode()
    storageMode.value = d && d.mode === 'cos' ? 'cos' : 'local'
    maxVideoSize.value = Number(d && d.maxVideoSize) || 0
  } catch (e) {
    storageMode.value = 'local'
    console.warn('[upload] 读取上传模式失败，按本地 multipart 处理:', e)
  }
}
// 取后端配置的允许导入目录：既用来提示，也用来决定 path 模式能否提交
async function loadImportRoots() {
  try {
    const d = await videoApi.importRoots()
    importRoots.value = d.dirs || []
  } catch {
    importRoots.value = []
  } finally {
    rootsLoaded.value = true
  }
}
onMounted(() => {
  loadUploadMode() // 先问后端是 COS 直传还是本地落盘，决定上传通道
  loadCollections()
  loadImportRoots()
})

function openCreateCollection() {
  newCol.value = { title: '', description: '', cover_url: '' }
  createDialog.value = true
}
async function submitNewCollection() {
  if (!newCol.value.title.trim()) return ElMessage.warning('请填写合集标题')
  creating.value = true
  try {
    const { id } = await adminApi.createCollection({
      title: newCol.value.title.trim(),
      description: newCol.value.description.trim(),
      cover_url: newCol.value.cover_url.trim(),
    })
    createDialog.value = false
    ElMessage.success('合集已创建')
    await loadCollections()
    collectionId.value = id // 自动选中新合集，接着填起始集数即可
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="upload container">
    <h1 class="page-title reveal">批量发布视频</h1>
    <p class="upload-sub meta-text">
      {{ mode === 'file'
        ? `一次选多个视频，逐个上传 · 支持 mp4 / webm / mkv / mov / ogg / avi 等格式${maxVideoSize ? `，单文件最大 ${fmtSize(maxVideoSize)}` : ''}`
        : '直接填服务器上的文件路径，由后端复制入库 · 适合文件本来就在这台机器上的情况' }}
      <span v-if="isCos" class="upload-mode-tag">COS 直传 · 不经过服务器中转</span>
    </p>

    <!-- 上传通道切换。COS 部署下「服务器路径导入」没意义（后端是 Serverless，
         机器上没有你的文件），直接把这个入口藏掉。 -->
    <div v-if="!isCos" class="mode-switch">
      <button class="cat-chip" :class="{ active: mode === 'file' }" @click="switchMode('file')">
        本地上传文件
      </button>
      <button class="cat-chip" :class="{ active: mode === 'path' }" @click="switchMode('path')">
        服务器路径导入
      </button>
    </div>

    <div class="upload-layout">
      <!-- 左：文件选择 + 队列 -->
      <div class="upload-left">
        <div
          v-if="mode === 'file'"
          class="dropzone"
          :class="{ dragging, has: !!queue.length }"
          @dragenter.prevent="dragging = true"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="onDrop"
        >
          <div class="dz-icon">📹</div>
          <div class="dz-title">拖拽视频到此处（支持多选）</div>
          <div class="dz-sub">或点击选择多个视频文件</div>
          <button class="btn btn-primary" @click="pickFile">选择视频</button>
          <input id="video-file-input" type="file" accept="video/*" multiple class="hidden-input" @change="onPick" />
        </div>

        <!-- 服务器路径导入 -->
        <div v-else class="path-box">
          <div class="pb-icon">🗂️</div>
          <div class="pb-title">填服务器上的文件路径</div>
          <div class="pb-sub">每行一个，可一次导入多个</div>
          <textarea
            v-model="pathInput"
            class="input path-input"
            placeholder="E:\movies\某部片子.mp4"
            spellcheck="false"
          ></textarea>

          <div v-if="rootsLoaded && !importRoots.length" class="pb-warn">
            尚未配置允许导入的目录。请在 <code>server/.env</code> 里设置
            <code>IMPORT_ALLOWED_DIRS</code>（多个目录用 <code>;</code> 分隔）后重启后端。
          </div>
          <div v-else-if="importRoots.length" class="pb-roots">
            允许的目录
            <span v-for="d in importRoots" :key="d" class="root-chip">{{ d }}</span>
          </div>

          <label class="pb-move">
            <input v-model="moveSource" type="checkbox" />
            <span>导入后删除原文件（即移动，默认只复制）</span>
          </label>

          <button class="btn btn-primary" :disabled="!importRoots.length" @click="addPaths">
            加入列表
          </button>
        </div>

        <div v-if="queue.length" class="queue-box">
          <div class="queue-head">
            <span>{{ mode === 'path' ? '待导入列表' : '待上传列表' }} <b>{{ queue.length }}</b></span>
            <span class="queue-sum">
              <template v-if="mode === 'file'">{{ fmtSize(totalBytes) }} · </template>{{ pendingCount }} 待处理
            </span>
          </div>
          <div class="queue-list">
            <div v-for="item in queue" :key="item.uid" class="queue-item" :class="item.status">
              <div class="qi-icon">{{ item.status === 'done' ? '✅' : item.status === 'failed' ? '⚠️' : item.status === 'uploading' ? (item.path ? '⏳' : '⬆️') : '🎞️' }}</div>
              <div class="qi-main">
                <div class="qi-title">{{ finalTitle(item) }}</div>
                <div class="qi-sub">
                  <span>{{ sizeText(item) }}</span>
                  <!-- 浏览器探到的时长（COS 模式下后端拿不到文件，只能靠它） -->
                  <span v-if="item.duration">{{ formatDuration(item.duration) }}</span>
                  <span v-else-if="item.metaState === 'probing'" class="qi-probing">读时长/封面…</span>
                  <span v-if="item.cosKey && item.status !== 'done'" class="qi-done">已直传，待入库</span>
                  <span v-if="item.path" class="qi-path" :title="item.path">{{ item.path }}</span>
                  <span v-if="item.status === 'failed'" class="qi-error">{{ item.error }}</span>
                  <span v-else-if="item.status === 'done'" class="qi-done">
                    ✓ 已发布
                    <router-link :to="{ name: 'play', params: { id: item.videoId } }">查看</router-link>
                  </span>
                  <span v-else-if="item.status === 'uploading'">
                    {{ item.path ? '导入中…' : item.progress + '%' }}
                  </span>
                </div>
                <div v-if="item.status === 'uploading' || item.status === 'done'" class="qi-track">
                  <!-- 路径导入在服务端拷贝，前端拿不到字节进度，用扫光表示「进行中」 -->
                  <div
                    class="qi-fill"
                    :class="{ sweep: item.path && item.status === 'uploading' }"
                    :style="item.path ? null : { width: item.progress + '%' }"
                  ></div>
                </div>
              </div>
              <div class="qi-actions">
                <button v-if="item.status === 'failed'" class="qi-retry" :disabled="uploading" @click="retryOne(item)">重试</button>
                <button v-if="item.status !== 'uploading'" class="qi-remove" @click="removeItem(item)" title="移除">×</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右：信息 + 进度 -->
      <div class="upload-form">
        <div class="field">
          <label>分类</label>
          <div class="cat-picker">
            <button
              v-for="c in categories"
              :key="c"
              class="cat-chip"
              :class="{ active: category === c }"
              @click="category = c"
            >
              {{ c }}
            </button>
          </div>
        </div>

        <div class="field">
          <label>所属合集（可选）</label>
          <div class="collection-pick">
            <select v-model="collectionId" class="input">
              <option :value="null">不加入合集</option>
              <option v-for="c in collections" :key="c.id" :value="c.id">{{ c.title }}（{{ c.episode_count }} 集）</option>
            </select>
            <button class="btn btn-new-col" type="button" @click="openCreateCollection">+ 新建合集</button>
          </div>
        </div>

        <div v-if="collectionId" class="field">
          <label>起始集数</label>
          <input v-model.number="startEpisode" class="input" type="number" min="1" placeholder="如从第 1 集开始，则填 1" />
          <p class="field-hint">批量上传时集数会从起始值依次递增</p>
        </div>

        <div class="field">
          <label>标题前缀（可选）</label>
          <input v-model="titlePrefix" class="input" type="text" placeholder="留空则用文件名作标题，如「我的剪辑」" maxlength="40" />
        </div>

        <!-- 封面：COS 模式下手填 URL 没地方落地（confirm 只认对象存储里的 cover_key），
             封面由浏览器从视频第 0.1 秒抽帧后直传生成，所以这种情况下把输入框藏掉，
             免得填了却没效果。 -->
        <div v-if="!isCos" class="field">
          <label>封面 URL（可选，应用到全部视频）</label>
          <input v-model="coverUrl" class="input" type="text" placeholder="https://…" />
        </div>
        <div v-else class="field">
          <label>封面</label>
          <p class="field-hint">自动从视频抽一帧当封面（不阻塞上传；解不了码的容器则留空）</p>
        </div>

        <div class="field">
          <label>简介（可选，应用到全部视频）</label>
          <textarea v-model="description" placeholder="介绍一下这批视频吧…" maxlength="2000"></textarea>
        </div>

        <div v-if="queue.length" class="overall-box">
          <div class="progress-label">
            <span>{{ (uploading ? (mode === 'path' ? '导入中' : '上传中') : '整体进度') }}…</span>
            <span>{{ overallPercent }}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: overallPercent + '%' }"></div>
          </div>
          <div v-if="mode === 'file'" class="meta-text">{{ fmtSize(loadedBytes) }} / {{ fmtSize(totalBytes) }}</div>
          <div v-else class="meta-text">已完成 {{ queue.filter((i) => i.status === 'done').length }} / {{ queue.length }}</div>
        </div>

        <button class="btn btn-primary upload-submit" :disabled="!pendingCount || uploading" @click="start">
          {{ uploading
            ? (mode === 'path' ? '导入中…' : `上传中 ${overallPercent}%…`)
            : pendingCount ? `${mode === 'path' ? '开始导入' : '开始上传'} ${pendingCount} 个` : '全部完成' }}
        </button>

        <div class="upload-hint">
          <span v-if="doneCount">✅ {{ doneCount }} 个已完成</span>
          <span v-if="failCount">❌ {{ failCount }} 个失败</span>
          <button v-if="doneCount && !uploading" class="link-btn" @click="clearFinished">清空已完成</button>
        </div>
      </div>
    </div>

    <!-- 上传时内联新建合集 -->
    <el-dialog v-model="createDialog" title="新建合集" width="460px" @open="openCreateCollection">
      <div class="dialog-form">
        <div class="field">
          <label>合集标题</label>
          <input v-model="newCol.title" class="input" type="text" maxlength="80" placeholder="如「爱情公寓」" />
        </div>
        <div class="field">
          <label>简介（可选）</label>
          <textarea v-model="newCol.description" class="input" placeholder="这个合集讲的是什么…" maxlength="500"></textarea>
        </div>
        <div class="field">
          <label>封面 URL（可选，留空则取第一集封面）</label>
          <input v-model="newCol.cover_url" class="input" type="text" placeholder="https://…" />
        </div>
      </div>
      <template #footer>
        <el-button @click="createDialog = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitNewCollection">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.upload { padding-top: 8px; }
.upload-sub { margin: 14px 0 24px; }
/* 存储模式标签：COS 直传时提示「不经过服务器中转」，避免误以为还是老的多部分上传 */
.upload-mode-tag {
  display: inline-block;
  margin-left: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--accent);
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}
/* 读时长/抽帧期间的小提示 */
.qi-probing { color: var(--text-faint); }

/* 上传通道切换 */
.mode-switch { display: flex; gap: 8px; margin-bottom: 20px; }

/* 服务器路径导入面板 */
.path-box {
  border: 2px dashed var(--border-strong);
  border-radius: var(--radius);
  padding: 26px 24px;
  background: var(--surface);
  text-align: center;
}
.pb-icon { font-size: 40px; margin-bottom: 8px; }
.pb-title { font-size: 17px; font-weight: 800; margin-bottom: 6px; }
.pb-sub { color: var(--text-faint); font-size: 13px; margin-bottom: 16px; }
.path-input {
  width: 100%;
  min-height: 110px;
  resize: vertical;
  text-align: left;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 13px;
  margin-bottom: 14px;
}
.pb-warn {
  text-align: left;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--accent-rose);
  background: var(--rose-soft);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  margin-bottom: 14px;
}
.pb-warn code {
  font-size: 12px;
  background: var(--surface-3);
  color: var(--text);
  padding: 1px 5px;
  border-radius: 4px;
}
.pb-roots {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  text-align: left;
  font-size: 12px;
  color: var(--text-faint);
  margin-bottom: 14px;
}
.root-chip {
  font-size: 12px;
  color: var(--accent-strong);
  background: var(--accent-soft);
  border-radius: 5px;
  padding: 2px 7px;
  word-break: break-all;
}
.pb-move {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 16px;
  cursor: pointer;
}
.pb-move input { flex-shrink: 0; }
.upload-layout {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: 24px;
  align-items: start;
}

.upload-left { min-width: 0; }
.dropzone {
  border: 2px dashed var(--border-strong);
  border-radius: var(--radius);
  padding: 44px 24px;
  text-align: center;
  background: var(--surface);
  transition: all 0.25s ease;
  cursor: pointer;
}
.dropzone:hover, .dropzone.dragging {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 40px var(--accent-glow);
}
.dropzone.has { border-style: solid; border-color: var(--accent); }
.dz-icon { font-size: 48px; margin-bottom: 10px; }
.dz-title { font-size: 18px; font-weight: 800; margin-bottom: 6px; }
.dz-sub { color: var(--text-faint); font-size: 13px; margin-bottom: 18px; }
.hidden-input { display: none; }

/* 文件队列 */
.queue-box { margin-top: 18px; }
.queue-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 10px;
}
.queue-head b { color: var(--accent); font-family: var(--font-syne); }
.queue-sum { font-family: var(--font-syne); font-size: 12px; color: var(--text-faint); }
.queue-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 420px;
  overflow-y: auto;
  padding-right: 4px;
}
.queue-item {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
}
.queue-item.uploading { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-soft); }
.queue-item.failed { border-color: transparent; box-shadow: 0 0 0 1px var(--rose-soft); }
.qi-icon { font-size: 20px; flex-shrink: 0; }
.qi-main { flex: 1; min-width: 0; }
.qi-title {
  font-size: 14px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qi-sub {
  margin-top: 3px;
  font-size: 12px;
  color: var(--text-faint);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.qi-error { color: var(--accent-rose); }
.qi-done { color: var(--accent-green); }
.qi-done a { color: var(--accent); margin-left: 2px; }
.qi-track {
  margin-top: 7px;
  height: 4px;
  border-radius: 4px;
  background: var(--surface-3);
  overflow: hidden;
}
.qi-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--accent);
  transition: width 0.2s ease;
}
/* 路径导入无字节进度，用呼吸式扫光表示「进行中」 */
.qi-fill.sweep {
  width: 100%;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  animation: qi-sweep 1.2s ease-in-out infinite;
}
@keyframes qi-sweep {
  0%, 100% { opacity: 0.25; }
  50% { opacity: 0.9; }
}
@media (prefers-reduced-motion: reduce) {
  .qi-fill.sweep { animation: none; opacity: 0.6; }
}
.qi-path {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11.5px;
}
.qi-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.qi-retry {
  border: 1px solid var(--accent);
  color: var(--accent-strong);
  background: transparent;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.qi-retry:disabled { opacity: 0.5; cursor: not-allowed; }
.qi-remove {
  border: none;
  background: transparent;
  color: var(--text-faint);
  font-size: 18px;
  line-height: 1;
  padding: 2px 6px;
  cursor: pointer;
}
.qi-remove:hover { color: var(--accent-rose); }

/* 右侧表单 */
.upload-form { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 26px; }
.field select.input {
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  padding-right: 38px;
  cursor: pointer;
}
.field-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-faint);
}
.collection-pick {
  display: flex;
  gap: 10px;
  align-items: center;
}
.collection-pick select.input { flex: 1; min-width: 0; }
.btn-new-col {
  flex-shrink: 0;
  border: 1px dashed var(--accent);
  color: var(--accent-strong);
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 9px;
  transition: all 0.15s;
  white-space: nowrap;
}
.btn-new-col:hover {
  background: var(--accent-soft);
  border-style: solid;
}
.dialog-form { padding: 4px 2px; }
.dialog-form textarea { min-height: 80px; resize: vertical; }
.dialog-form .field { margin-bottom: 16px; }
.dialog-form .field:last-child { margin-bottom: 0; }
.cat-picker { display: flex; flex-wrap: wrap; gap: 8px; }
.cat-chip {
  border: 1px solid var(--border);
  background: var(--bg-soft);
  color: var(--text-dim);
  font-size: 13px;
  padding: 7px 14px;
  border-radius: 999px;
  transition: all 0.15s;
}
.cat-chip:hover { color: var(--text); }
.cat-chip.active {
  background: var(--accent);
  color: var(--accent-text);
  border-color: transparent;
  font-weight: 700;
}

.overall-box {
  margin: 6px 0 16px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 14px;
}
.progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 8px;
}
.progress-track { height: 8px; border-radius: 8px; background: var(--surface-3); overflow: hidden; }
.progress-fill {
  height: 100%;
  border-radius: 8px;
  background: var(--accent);
  transition: width 0.2s ease;
  box-shadow: 0 0 12px var(--accent-glow);
}
.overall-box .meta-text { margin-top: 6px; font-size: 12px; }

.upload-submit { width: 100%; padding: 13px; font-size: 15px; margin-top: 6px; }
.upload-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 14px;
  font-size: 13px;
  color: var(--text-dim);
}
.link-btn {
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 13px;
  cursor: pointer;
  padding: 0;
}
.link-btn:hover { text-decoration: underline; }

@media (max-width: 860px) {
  .upload-layout { grid-template-columns: 1fr; }
}
</style>
