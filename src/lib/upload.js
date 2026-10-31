/**
 * 上传相关的浏览器端工具。
 *
 * 三件事，都是「尽力而为，绝不阻塞上传」：
 *   1. 读视频时长（`<video>` + object URL，读 loadedmetadata）；
 *   2. 从第 0.1 秒抓一帧，等比缩到 640 宽，编码成 JPEG 当封面；
 *   3. 把文件 PUT 到后端签发的预签名地址（COS 直传）。
 *
 * ⚠️ 第 3 步有几个必须守住的点，写错就是 403 / 附件下载而不是播放：
 *   - **不能带 Authorization**：预签名地址本身已含鉴权（q-sign-algorithm 等参数），
 *     再叠一个 Bearer 头会让 COS 判定签名不匹配；而且这本来就是跨域请求，
 *     带 token 出去等于把凭证交给第三方域名。
 *   - **不能用 api 那个 axios 实例**：它的 baseURL 是 /api（或后端域名）、拦截器会加
 *     Authorization、默认还带 Content-Type。这里用裸 XHR，一个默认头都不加。
 *   - **不能超时**：GB 级视频传十几分钟很正常，XHR 设为无超时。
 */

const COVER_WIDTH = 640 // 封面宽（不放大，源视频更小就按源宽）
const COVER_QUALITY = 0.85
const COVER_SEEK_SEC = 0.1 // 抓帧时间点：太靠 0 秒常是黑场
const DEFAULT_TIMEOUT = 15000 // 读元数据/抽帧的超时，超时就当没读到

/** 超时就返回 fallback 的 Promise 包装（不 reject，调用方无需 try/catch） */
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      resolve(fallback)
    }, ms)
    promise.then(
      (v) => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(v)
      },
      () => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(fallback)
      },
    )
  })
}

/**
 * 抓一帧当封面。
 * @returns {Promise<Blob|null>} 拿不到（编码不支持 / 全是黑场 / seek 失败）时返回 null
 */
async function grabCover(el, { width = COVER_WIDTH, quality = COVER_QUALITY } = {}) {
  const vw = el.videoWidth || 0
  const vh = el.videoHeight || 0
  if (!vw || !vh) return null // mkv 之类解不了码：直接放弃封面

  // 抓帧点：0.1 秒；极短视频退到「总长的 1/10」，避免 seek 越界被丢弃
  const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0
  const at = dur ? Math.min(COVER_SEEK_SEC, dur / 10) : COVER_SEEK_SEC

  const seeked = await withTimeout(
    new Promise((resolve) => {
      el.addEventListener('seeked', () => resolve(true), { once: true })
      try {
        el.currentTime = at
      } catch {
        resolve(false)
      }
    }),
    5000,
    false,
  )
  if (!seeked) return null

  const outW = Math.max(1, Math.min(width, vw)) // 不放大：源视频比 640 窄就按源宽
  const outH = Math.max(1, Math.round((outW * vh) / vw))
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  try {
    ctx.drawImage(el, 0, 0, outW, outH)
  } catch {
    return null // 极少数浏览器对未解码的源会抛
  }
  return await withTimeout(
    new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality)),
    5000,
    null,
  )
}

/**
 * 读视频元信息：时长 + 一帧封面。
 *
 * 任何失败都退化成 `{ duration: 0, cover: null }` —— 时长只是锦上添花（后端也允许 0），
 * 封面没有也能入库。**绝不能因为读不出来就不让上传**（mkv/avi 很常见）。
 */
async function readVideoMeta(file, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT
  const result = { duration: 0, cover: null }
  if (!file) return result

  let objectUrl = ''
  let el = null
  try {
    objectUrl = URL.createObjectURL(file)
    el = document.createElement('video')
    el.preload = 'auto'
    el.muted = true
    el.setAttribute('playsinline', '')
    el.setAttribute('webkit-playsinline', '')
    // 挂到 DOM（1px 不可见）。部分浏览器对**没进文档**的 video 不解码当前帧，
    // drawImage 会得到空白；但 display:none 同样会阻止解码，所以只用位移和透明度藏。
    el.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
    document.body.appendChild(el)

    const loaded = await withTimeout(
      new Promise((resolve) => {
        el.addEventListener('loadedmetadata', () => resolve(true), { once: true })
        el.addEventListener('error', () => resolve(false), { once: true })
        el.src = objectUrl
        el.load()
      }),
      timeoutMs,
      false,
    )
    if (!loaded) return result

    if (Number.isFinite(el.duration) && el.duration > 0) result.duration = el.duration
    result.cover = await grabCover(el, opts)
    return result
  } catch {
    return result
  } finally {
    try {
      if (el) {
        el.removeAttribute('src')
        el.load() // 断开解码器，及时释放内存
        el.remove()
      }
    } catch {
      /* 清理失败无所谓 */
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

// ---- 探测并发闸门 ----------------------------------------------------------
// 批量上传一次选十个视频时，如果十个 <video> 同时开解码器去读元数据/抽帧，
// 低配机器上很容易把标签页拖死（每个都要读 moov + 解一帧）。这里最多同时跑 2 个，
// 其余排队 —— 反正真正上传是串行的，探测慢一点没人看得出来。
const PROBE_CONCURRENCY = 2
let probeActive = 0
const probeWaiting = []

function runInProbeSlot(task) {
  return new Promise((resolve) => {
    const start = () => {
      probeActive++
      Promise.resolve()
        .then(task)
        .then(resolve, () => resolve({ duration: 0, cover: null }))
        .then(() => {
          probeActive--
          const next = probeWaiting.shift()
          if (next) next()
        })
    }
    if (probeActive < PROBE_CONCURRENCY) start()
    else probeWaiting.push(start)
  })
}

/**
 * 读时长 + 抽一帧封面的对外入口（带并发限制）。
 * @returns {Promise<{duration: number, cover: Blob|null}>} 永不 reject
 */
export function probeVideoFile(file, opts = {}) {
  if (!file) return Promise.resolve({ duration: 0, cover: null })
  return runInProbeSlot(() => readVideoMeta(file, opts))
}

/** 从 COS 的错误 XML 里抠出 <Message>，让 403 之类有一句人能读的说明 */
function cosErrorDetail(text) {
  if (!text) return ''
  try {
    const m = /<Message>([\s\S]*?)<\/Message>/i.exec(text)
    if (m) return m[1].trim()
    const c = /<Code>([\s\S]*?)<\/Code>/i.exec(text)
    if (c) return c[1].trim()
  } catch {
    /* 不是 XML 就算了 */
  }
  return ''
}

/**
 * 把二进制 PUT 到预签名地址。
 *
 * @param {string} url   后端签发的预签名地址（自带鉴权参数）
 * @param {Blob}   body  要传的文件/Blob
 * @param {object} opts  { onProgress(e), contentType }
 * @returns {Promise<{status:number}>}
 */
export function putToSignedUrl(url, body, { onProgress, contentType } = {}) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('缺少预签名上传地址'))
      return
    }
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url, true)
    xhr.withCredentials = false // 预签名地址不需要 Cookie；带上反而常被 CORS 拦
    xhr.timeout = 0 // 不超时：大文件可能传很久
    if (contentType) xhr.setRequestHeader('Content-Type', contentType)

    if (typeof onProgress === 'function') {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ status: xhr.status })
        return
      }
      const detail = cosErrorDetail(xhr.responseText)
      reject(
        new Error(
          `对象存储上传失败（HTTP ${xhr.status}）${detail ? `：${detail}` : ''}`,
        ),
      )
    }
    xhr.onerror = () =>
      reject(new Error('对象存储上传失败：跨域被拒或网络错误（请检查桶的 CORS 是否允许本站 PUT）'))
    xhr.ontimeout = () => reject(new Error('对象存储上传超时'))
    xhr.onabort = () => reject(new Error('上传已取消'))
    try {
      xhr.send(body)
    } catch (e) {
      reject(new Error(`上传请求发送失败：${e.message || e}`))
    }
  })
}
