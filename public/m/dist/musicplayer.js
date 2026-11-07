/*
 * <music-player> 前端垫片（shim）
 * ---------------------------------------------------------------------------
 * 仓库根原来的 musicplayer/（yc-musicplayer 打包产物）已经丢失，线上又必须由前端自己
 * 提供这个脚本（/music 按 <script src="/m/dist/musicplayer.js"> 加载），所以这里用一个
 * 「纯音频引擎」把页面实际用到的契约原样实现一遍。
 *
 * 设计原则：**只做页面真的用到的事，不多做一件**。
 *   - 不发任何网络请求（不读 /m/api/v1/songs，也不按 playlist-url / stream-url 去拉数据）；
 *     曲库由页面通过 setSongs() 灌进来，url/coverUrl 由后端注入、页面已补好跨域基址。
 *   - 不渲染 UI：页面用 class="mp-hidden"(display:none) 把它当纯引擎藏在 DOM 里，
 *     播放能力全来自内部那个 `new Audio()`（游离元素，不在 shadow 里，隐藏不影响播放）。
 *   - 暴露给页面的 `audio` 是真正的 HTMLAudioElement：页面要直接读写 currentTime /
 *     duration / volume / muted，并在上面挂 play / pause / loadedmetadata / durationchange
 *     监听。这是契约里最容易忽略、但一改就全瘫的一条。
 *
 * 契约清单（来自 web/src/views/Music.vue 与 README「组件契约」，改这里前先对照）：
 *   属性  playlist（内联 JSON，优先级最高；"[]" 表示「别自己拉数据」）、
 *         playlist-url / stream-url / lyric-url / cover-url / position / theme（接受但不使用）
 *   方法  setSongs / playSong / play / pause / getCurrentSong / nextSong / prevSong /
 *         playNext / setVolume / toggleMute / seekTo / setLyrics / togglePlay
 *   事件  musicplayer:change → e.detail = { index, song, length }
 *         musicplayer:error  → e.detail = { message, code, song, index }
 *
 * 关键行为（每一条都是踩坑踩出来的）：
 *   1. setSongs() 末尾会 playSong(0, true) —— **静默**跳到第 0 首（不自动播放）。
 *      所以页面「续签名」绝不能重灌列表，只能在原位改 song.url/coverUrl（见 refreshUrls）。
 *   2. nextSong 是原型方法：页面会把它**覆盖成实例属性**来接管播放模式。因此内部 ended
 *      回调必须写 `this.nextSong()`（调用时才查找），不能提前 bind 一份存起来。
 *   3. song.url 为空 == 不可播：不写 src，直接派发 musicplayer:error。
 *   4. _nextUp 是「下一首播放」的 FIFO 队列，由 nextSong() 优先消费。
 *   5. 下标必须与页面展示数组严格同构：页面用 playAt(di) 直接传下标。
 */
;(function () {
  'use strict'

  if (!window.customElements || window.customElements.get('music-player')) return // 幂等

  const DEFAULT_VOLUME = 0.8 // 与旧组件一致；页面会从 audio.volume 读初值

  function parsePlaylistAttr(value) {
    if (value == null) return null
    const s = String(value).trim()
    if (!s) return null
    try {
      const v = JSON.parse(s)
      return Array.isArray(v) ? v : null
    } catch (e) {
      console.warn('[musicplayer] playlist 属性不是合法 JSON，已忽略:', s.slice(0, 80))
      return null
    }
  }

  class MusicPlayer extends HTMLElement {
    static get observedAttributes() {
      return ['playlist']
    }

    constructor() {
      super()

      // ---- 音频引擎：游离的 <audio>（不进 shadow，也不挂进文档） ----
      // 页面会直接往上挂监听、读写属性，所以必须是真元素且常驻。
      //
      // ⚠️ crossOrigin 必须在设置 src 之前设：全屏播放页会用 Web Audio 的
      // MediaElementSource 接频谱，音频是从 API 302 跳到 COS 的跨域资源；
      // 不带 CORS 时浏览器把媒体标记为 tainted，analyser 全零、输出静音
      // （进度条照走，就是没声音）。生产 302 与 COS 都已回 ACAO，可走 CORS。
      this.audio = new Audio()
      this.audio.crossOrigin = 'anonymous'
      this.audio.preload = 'auto'
      this.audio.volume = DEFAULT_VOLUME
      this.audio.setAttribute('playsinline', '')

      // ---- 状态 ----
      this.songs = [] // 播放列表：页面灌进来的对象数组（元素就是页面自己的对象）
      this.lyrics = [] // 已解析的歌词数组；LRC 原文会被丢弃（见 setLyrics）
      this._currentIndex = -1
      this._nextUp = [] // 「下一首播放」FIFO 队列
      this._suppressError = false // 主动清源时别把 error 冒出去

      // ended → 自动切歌。⚠️ 必须每次调用时再查 this.nextSong：页面会用实例属性覆盖它
      // 来实现「单曲循环 / 随机」，提前 bind 就会绕开那层逻辑。
      this.audio.addEventListener('ended', () => {
        if (typeof this.nextSong === 'function') this.nextSong()
      })

      // 媒体层错误（签名过期 / 404 / 编码不支持）→ 交给页面续签
      this.audio.addEventListener('error', () => {
        if (this._suppressError) return
        const err = this.audio.error
        this._emit('musicplayer:error', {
          message: (err && err.message) || '音频加载失败',
          code: err ? err.code : 0,
          song: this.getCurrentSong(),
          index: this._currentIndex,
        })
      })
    }

    /* ---------------------------------------------------------------- 内部 */

    _emit(name, detail) {
      try {
        this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
      } catch (e) {
        console.error('[musicplayer] 派发事件失败:', name, e)
      }
    }

    _emitChange() {
      this._emit('musicplayer:change', {
        index: this._currentIndex,
        song: this.getCurrentSong(),
        length: this.songs.length,
      })
    }

    /** 主动清掉音源（不派发 error） */
    _clearSrc() {
      const a = this.audio
      if (!a) return
      this._suppressError = true
      try {
        a.pause()
        a.removeAttribute('src')
        a.load() // 断开解码器，释放资源
      } catch (e) {
        /* 忽略 */
      }
      setTimeout(() => {
        this._suppressError = false
      }, 0)
    }

    _indexOfSong(song) {
      if (!song) return -1
      const byRef = this.songs.indexOf(song) // 页面传的就是列表里的同一个对象引用
      if (byRef >= 0) return byRef
      const fn = song.filename
      if (fn) {
        for (let i = 0; i < this.songs.length; i++) {
          if (this.songs[i] && this.songs[i].filename === fn) return i
        }
      }
      return -1
    }

    _start() {
      const p = this.audio.play()
      // 自动播放被拦 / 源被换掉：不派发 error（那会让页面去做「续签名」这种无关动作），
      // 静默记录即可 —— 页面自己会根据 audio.paused 同步 UI。
      if (p && typeof p.catch === 'function') {
        p.catch((e) => {
          if (e && e.name !== 'NotAllowedError' && e.name !== 'AbortError') {
            console.warn('[musicplayer] 播放失败:', e)
          }
        })
      }
    }

    /* ------------------------------------------------------------ 生命周期 */

    connectedCallback() {
      // 不自动播放：什么时候出声由页面决定
    }

    disconnectedCallback() {
      // 与旧组件一致：从 DOM 摘掉就停播并清源，避免路由切换后音乐还在响。
      // 只停播、不清列表 —— 页面可能只是 v-if 重渲染了外层容器。
      this._clearSrc()
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (name !== 'playlist' || oldValue === newValue) return
      const list = parsePlaylistAttr(newValue)
      if (list) this.setSongs(list)
      // playlist 为空 / 非法：保持现状，绝不去 playlist-url 拉数据
    }

    /* ---------------------------------------------------------------- 属性 */

    get currentIndex() {
      return this._currentIndex
    }

    get currentSong() {
      return this.getCurrentSong()
    }

    /* ---------------------------------------------------------------- 方法 */

    /**
     * 灌列表。末尾**静默**跳到第 0 首（不自动播放），并按契约派发一次 change。
     * @param {Array} list 页面自己的歌曲对象数组
     */
    setSongs(list) {
      this.songs = Array.isArray(list) ? list.slice() : []
      this._nextUp = []
      if (!this.songs.length) {
        this._currentIndex = -1
        this._clearSrc()
        this._emitChange()
        return
      }
      this.playSong(0, true) // 静默：只加载，不出声
    }

    /**
     * 切到第 index 首。
     * @param {number} index  任意整数都行（内部取模，负数也能用）
     * @param {boolean} silent true = 只加载不播放（页面用它做「静默重载」）
     * @returns {boolean} 是否成功拿到可播地址
     */
    playSong(index, silent) {
      const n = this.songs.length
      if (!n) {
        this._currentIndex = -1
        this._clearSrc()
        this._emitChange()
        return false
      }
      let i = Math.floor(Number(index) || 0)
      i = ((i % n) + n) % n
      const changed = i !== this._currentIndex
      this._currentIndex = i
      const song = this.songs[i]
      const url = song && song.url ? String(song.url) : ''

      // 先同步状态再派发：监听方（页面）会在回调里读 getCurrentSong()
      if (changed) this._emitChange()

      if (!url) {
        // url 为空 == 不可播（未绑定酷狗 / 未缓存）。不写 src，直接交给页面处理。
        this._clearSrc()
        this._emit('musicplayer:error', {
          message: '这首曲目暂时没有可播放的地址',
          code: 0,
          song: song || null,
          index: i,
        })
        return false
      }

      try {
        this.audio.src = url
      } catch (e) {
        console.warn('[musicplayer] 设置音频地址失败:', e)
        return false
      }
      if (!silent) this._start()
      return true
    }

    /** 播第 index 首（不给下标就继续播当前曲） */
    play(index) {
      if (!this.songs.length) return false
      if (index == null || index < 0) {
        if (this._currentIndex < 0) return this.playSong(0, false)
        this._start()
        return true
      }
      const i = Math.floor(Number(index) || 0)
      if (i === this._currentIndex) {
        this._start()
        return true
      }
      return this.playSong(i, false)
    }

    pause() {
      try {
        this.audio.pause()
      } catch (e) {
        /* 忽略 */
      }
    }

    /** 在「播 / 停」之间切换，返回切换后的播放状态 */
    togglePlay() {
      if (this.audio.paused) {
        if (this._currentIndex < 0 && this.songs.length) this.playSong(0, false)
        else this._start()
      } else {
        this.audio.pause()
      }
      return !this.audio.paused
    }

    getCurrentSong() {
      if (this._currentIndex < 0 || this._currentIndex >= this.songs.length) return null
      return this.songs[this._currentIndex] || null
    }

    /**
     * 下一首。「下一首播放」队列优先，否则线性 +1（取模 = 列表循环）。
     * ⚠️ 页面会把这个方法整个覆盖掉来实现播放模式，内部必须始终走 `this.nextSong()`。
     */
    nextSong() {
      const n = this.songs.length
      if (!n) return false
      if (this._nextUp.length) {
        const queued = this._nextUp.shift()
        const qi = this._indexOfSong(queued)
        if (qi >= 0) return this.playSong(qi, false)
        // 队列里的歌不在当前列表（换过库）：丢掉它，退回线性
      }
      return this.playSong(this._currentIndex + 1, false)
    }

    prevSong() {
      if (!this.songs.length) return false
      return this.playSong(this._currentIndex - 1, false)
    }

    /**
     * 「下一首播放」：把这首歌排到当前曲之后（FIFO）。
     * 只入队、不改播放状态 —— 用户期望的是「这首放完再放它」。
     */
    playNext(song) {
      const i = this._indexOfSong(song)
      if (i >= 0) {
        this._nextUp.push(this.songs[i])
        return true
      }
      // 不在列表里：直接播（否则入队也无从消费）
      if (song && song.url) {
        this.songs.push(song)
        return this.playSong(this.songs.length - 1, false)
      }
      return false
    }

    /** 音量 0–100（页面会先夹一次；这里再夹一次，避免越界抛错打断页面流程） */
    setVolume(v) {
      const n = Number(v)
      if (!isFinite(n)) return
      const vol = Math.max(0, Math.min(100, n)) / 100
      try {
        this.audio.volume = vol
        if (vol > 0 && this.audio.muted) this.audio.muted = false
      } catch (e) {
        console.warn('[musicplayer] 设置音量失败:', e)
      }
    }

    getVolume() {
      return Math.round((this.audio.volume || 0) * 100)
    }

    /** 切换静音，返回「现在是否静音」 */
    toggleMute() {
      this.audio.muted = !this.audio.muted
      return this.audio.muted
    }

    seekTo(seconds) {
      const t = Number(seconds)
      if (!isFinite(t) || t < 0) return
      try {
        this.audio.currentTime = t
      } catch (e) {
        /* 元数据未就绪，忽略 */
      }
    }

    /**
     * 歌词。只接受**已解析的数组**（[{time, text}]）；给 LRC 原文一律视为「暂无歌词」，
     * 免得时间轴被渲染成一整块字符串 —— 旧组件就是这个行为，页面按这个预期在用。
     */
    setLyrics(arr) {
      this.lyrics = Array.isArray(arr) ? arr : []
      return this.lyrics
    }

    /** 冒烟/排障用：返回当前引擎状态（不影响播放） */
    getState() {
      return {
        index: this._currentIndex,
        length: this.songs.length,
        paused: this.audio.paused,
        volume: this.getVolume(),
        muted: !!this.audio.muted,
        src: this.audio.currentSrc || this.audio.src || '',
        nextUp: this._nextUp.length,
      }
    }
  }

  try {
    window.customElements.define('music-player', MusicPlayer)
    window.__musicplayerShim = '1.0.0'
  } catch (e) {
    console.error('[musicplayer] 注册自定义元素失败:', e)
  }
})()
