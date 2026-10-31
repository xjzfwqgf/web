import axios from 'axios'

/**
 * 后端 API 基址。
 *
 * - 线上（前端 Vercel 静态站 + 后端另一个 Vercel 项目）：VITE_API_BASE 配成后端域名，
 *   例如 https://video-site-api.vercel.app，所有请求打过去。
 * - 本地开发：留空串，继续走 vite 的 /api 代理（见 vite.config.js），零配置。
 *
 * 末尾的斜杠统一剥掉，避免拼出 `//api/...`。
 */
export const API_BASE = String(import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')

export const API_ROOT = `${API_BASE}/api`

const http = axios.create({ baseURL: API_ROOT, timeout: 30000 })

// 请求携带 token
http.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// 统一错误提示
http.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const msg = err.response?.data?.message || '网络请求失败'
    return Promise.reject(new Error(msg))
  },
)

/**
 * 把**后端返回的资源地址**变成浏览器可直接用的地址。
 *
 * 后端现在三种来源混着来：
 *   - COS/CDN 绝对地址（https://cdn.xxx/videos/a.mp4）→ 原样用；
 *   - 本地模式 /uploads/xxx（相对本后端的根）→ 跨域部署时必须补上 VITE_API_BASE，
 *     否则会去前端域名（Vercel 静态站）上找这个文件，必然 404；
 *   - data:/blob:（前端占位图、直传预览）→ 原样用。
 *
 * 注意别对已经带域名的地址重复拼前缀，所以只处理以单个 `/` 开头的。
 */
export function assetUrl(u) {
  const s = typeof u === 'string' ? u.trim() : ''
  if (!s) return ''
  // 绝对地址（http(s)、协议相对 //、以及 data:/blob: 这类内联资源）
  if (/^(?:https?:)?\/\//i.test(s) || /^(?:data|blob):/i.test(s)) return s
  // 以 / 开头：这是后端自身路径（/uploads/...、/api/...），拼上 API 基址。
  // API_BASE 为空（本地开发）时原样返回，仍然走 vite 代理。
  if (s.startsWith('/')) return `${API_BASE}${s}`
  return s
}

/**
 * 把一个后端相对路径拼成绝对 URL（用于 window.location 跳转这类不走 axios 的场景）。
 * 与 assetUrl 的区别只是语义：它专门给「已知是后端路径」的调用点用。
 */
export function apiUrl(path) {
  const p = String(path || '')
  if (/^(?:https?:)?\/\//i.test(p)) return p
  const withSlash = p.startsWith('/') ? p : `/${p}`
  return `${API_BASE}${withSlash}`
}

/**
 * 解析后端时间戳。
 *
 * 后端统一存 UTC，形如 "2026-10-31 11:00:00"（SQLite datetime('now') 的默认格式），
 * **不带时区标记**。这种字符串直接 `new Date(s)` 会被 ES 规范当作**本地时间**，
 * 在东八区就整整差 8 小时（显示成 8 小时前的事）。所以这里显式按 UTC 解析。
 *
 * 已经带时区标记的（ISO `...Z` / `+08:00`）绝不重复加，直接交给 Date。
 */
export function parseServerTime(ts) {
  if (!ts) return null
  if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts
  const s = String(ts).trim()
  if (!s) return null
  const hasZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(s)
  if (hasZone) {
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d
  }
  // 只对 "YYYY-MM-DD HH:MM[:SS[.fff]]" / "YYYY-MM-DDTHH:MM..." 这类无时区的做补 Z
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)$/.exec(s)
  const d = m ? new Date(`${m[1]}T${m[2]}Z`) : new Date(s)
  return isNaN(d.getTime()) ? null : d
}

export const authApi = {
  register: (data) => http.post('/auth/register', data),
  login: (data) => http.post('/auth/login', data),
  me: () => http.get('/auth/me'),
  updateMe: (data) => http.put('/auth/me', data),
  changePassword: (data) => http.put('/auth/me/password', data),
}

export const videoApi = {
  list: (params) => http.get('/video/list', { params }),
  categories: () => http.get('/video/categories'),
  detail: (id) => http.get(`/video/${id}`),
  view: (id) => http.post(`/video/${id}/view`),
  upload: (formData, onProgress) =>
    http.post('/video', formData, { timeout: 0, onUploadProgress: onProgress }),
  // 存储模式：cos（浏览器直传对象存储）/ local（multipart 传给后端）
  uploadMode: () => http.get('/video/upload-mode'),
  // COS 直传：拿预签名 PUT 地址（kind: 'video' | 'cover'）
  presign: (data) => http.post('/video/presign', data),
  // COS 直传：文件已上传成功后入库
  confirm: (data) => http.post('/video/confirm', data),
  // 分片上传（>5GB，COS 单次 PUT 上限）：init → 逐片 PUT → complete
  multipartInit: (data) => http.post('/video/multipart/init', data),
  multipartSign: (data) => http.post('/video/multipart/sign', data),
  multipartComplete: (data) => http.post('/video/multipart/complete', data, { timeout: 0 }),
  multipartAbort: (data) => http.post('/video/multipart/abort', data),
  // 从服务器本机路径导入（仅管理员）。复制大文件 + 服务端 ffmpeg 抽帧远超默认 30s，故不限时。
  importLocal: (data) => http.post('/video/import-local', data, { timeout: 0 }),
  importRoots: () => http.get('/video/import-roots'),
  remove: (id) => http.delete(`/video/${id}`),
}

export const interactionApi = {
  like: (id) => http.post(`/interaction/video/${id}/like`),
  favorite: (id) => http.post(`/interaction/video/${id}/favorite`),
  history: (id, progress) => http.post(`/interaction/video/${id}/history`, { progress }),
  myFavorites: (params) => http.get('/interaction/me/favorites', { params }),
  myUploads: (params) => http.get('/interaction/me/uploads', { params }),
  myHistory: (params) => http.get('/interaction/me/history', { params }),
  clearHistory: () => http.delete('/interaction/me/history'),
}

export const commentApi = {
  list: (id, params) => http.get(`/comment/video/${id}/comments`, { params }),
  add: (id, data) => http.post(`/comment/video/${id}/comments`, data),
  remove: (id) => http.delete(`/comment/comments/${id}`),
}

export const danmakuApi = {
  list: (id) => http.get(`/danmaku/video/${id}/danmaku`),
  add: (id, data) => http.post(`/danmaku/video/${id}/danmaku`, data),
}

export const collectionApi = {
  list: () => http.get('/collection/list'),
  detail: (id) => http.get(`/collection/${id}`),
}

export const adminApi = {
  stats: () => http.get('/admin/stats'),
  users: (params) => http.get('/admin/users', { params }),
  banUser: (id) => http.post(`/admin/users/${id}/ban`),
  unbanUser: (id) => http.post(`/admin/users/${id}/unban`),
  setRole: (id, role) => http.put(`/admin/users/${id}/role`, { role }),
  videos: (params) => http.get('/admin/videos', { params }),
  setVideoStatus: (id, status) => http.post(`/admin/videos/${id}/status`, { status }),
  removeVideo: (id) => http.delete(`/admin/videos/${id}`),
  // 批量删除：后端单次最多 200 个，子表在同一个事务里级联清理
  batchRemoveVideos: (ids) => http.post('/admin/videos/batch-delete', { ids }),
  comments: (params) => http.get('/admin/comments', { params }),
  removeComment: (id) => http.delete(`/admin/comments/${id}`),
  danmaku: (params) => http.get('/admin/danmaku', { params }),
  removeDanmaku: (id) => http.delete(`/admin/danmaku/${id}`),
  collections: (params) => http.get('/admin/collections', { params }),
  createCollection: (data) => http.post('/admin/collections', data),
  updateCollection: (id, data) => http.put(`/admin/collections/${id}`, data),
  removeCollection: (id) => http.delete(`/admin/collections/${id}`),
  collectionVideos: (id) => http.get(`/admin/collections/${id}/videos`),
  addCollectionVideo: (id, data) => http.post(`/admin/collections/${id}/videos`, data),
  removeCollectionVideo: (id, videoId) => http.delete(`/admin/collections/${id}/videos/${videoId}`),
  updateVideo: (id, data) => http.put(`/admin/videos/${id}`, data),
  assignVideos: (data) => http.post('/admin/videos/assign-collection', data),
}

export function formatCount(n) {
  if (n == null) return '0'
  if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '亿'
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万'
  return String(n)
}

export function formatDuration(seconds) {
  seconds = Math.max(0, Math.round(seconds || 0))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (x) => String(x).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export function timeAgo(ts) {
  if (!ts) return ''
  const date = parseServerTime(ts)
  if (!date) return ''
  const diff = Date.now() - date.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return date.toLocaleDateString()
}
