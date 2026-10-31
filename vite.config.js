import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 后端监听在哪个端口，取决于 server/.env 有没有配 HTTPS 证书：
 *   配了且文件存在 → HTTPS（默认 443）
 *   没配           → HTTP（默认 3000）
 *
 * 这里跟着后端一起判断，而不是写死 3000。写死的话，一旦 .env 配了证书，
 * 代理就会指向一个根本没在监听的端口 —— 表现为前端页面能打开、但所有 /api 请求
 * 全部 ECONNREFUSED，且没有任何明显提示，极难排查。
 */
function backendTarget() {
  const fallback = { target: 'http://localhost:3000', secure: false }
  // 后端地址默认 localhost。若代理报 ECONNREFUSED / 一直挂起，多半是 localhost
  // 解析到了 IPv4，而 IPv4 的 443 被别的软件占着（本机就撞过 Steam++ 加速器，
  // 后端本身绑的是 [::]:443）。此时用 BACKEND_HOST=::1 启动即可：
  //     BACKEND_HOST=::1 npm run dev
  const host = process.env.BACKEND_HOST || 'localhost'
  const h = host.includes(':') ? `[${host}]` : host
  try {
    const env = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'server', '.env'), 'utf8')
    const get = (k) => (env.match(new RegExp(`^${k}\\s*=(.*)$`, 'm')) || [])[1]?.trim() || ''
    const cert = get('HTTPS_CERT')
    const key = get('HTTPS_KEY')
    if (cert && key && fs.existsSync(cert) && fs.existsSync(key)) {
      return {
        target: `https://${h}:${get('HTTPS_PORT') || '443'}`,
        // 证书签的是站点域名，用 localhost 访问必然域名不匹配 —— 关掉上游证书校验。
        // 仅影响本机开发代理这一跳，不影响浏览器与站点之间的 TLS。
        secure: false,
      }
    }
  } catch {
    /* 读不到 .env（比如还没创建）就按 HTTP 默认处理 */
  }
  return fallback
}

const backend = backendTarget()

/** 三个前缀共用同一份后端目标，避免改了一个漏了另一个 */
const toBackend = () => ({ target: backend.target, changeOrigin: true, secure: backend.secure })

export default defineConfig({
  plugins: [
    vue({
      compilerOptions: {
        // 音乐模块的 Web Component，让 Vue 将其当作自定义元素渲染、不做组件解析
        isCustomElement: (tag) => tag === 'music-player',
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': toBackend(),
      '/uploads': toBackend(),
      // 音乐模块的组件脚本 /m/dist/musicplayer.js 现在是**前端自己的静态资源**
      // （web/public/m/dist/musicplayer.js），必须由 vite 直接命中 public 目录，
      // 所以这里**不能**再代理 /m/dist 或 /m/api —— 代理会把它转发给后端，线上后端
      // 也没有这个文件，只会得到 404。
      // 曲库/音频已全部改由 /api/music/* 提供，上面那条 '/api' 已经覆盖。
    },
  },
})
