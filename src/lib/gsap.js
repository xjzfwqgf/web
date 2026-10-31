import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

// 统一的缓动曲线（深夜影院质感）
export const EASE = 'power3.out'

// Spring 物理：用 GSAP 过冲曲线实现「活」的交互（零新增依赖）
// back.out(1.4) —— 进场上冲，轻微过冲后回落
// elastic.out(1, 0.5) —— 强调/回弹，更明显的弹跳
export const SPRING = { ease: 'back.out(1.4)' }
export const SPRING_ELASTIC = { ease: 'elastic.out(1, 0.5)' }

// 用户是否弱化动效（减弱动效时退化成交叉淡化，不做位移/过冲）
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// 常见入场动画：从下方浮入 + 淡入。
// ease 可传入 'back.out(1.4)' 等字符串，或 { ease: 'back.out(1.4)' } 对象；
// 弱化动效时自动退化为纯 opacity 交叉淡化（去位移、去过冲、缩短时长）。
export function revealFrom(el, { y = 40, delay = 0, duration = 0.65, once = true, ease = EASE, ...rest } = {}) {
  const reduced = prefersReducedMotion()
  const opts = reduced
    ? { y: 0, opacity: 1, duration: 0.2, delay, ease: 'power1.out' }
    : { y: 0, opacity: 1, duration, delay, ease, ...rest }
  return gsap.fromTo(
    el,
    { y: reduced ? 0 : y, opacity: 0 },
    {
      ...opts,
      // clearProps：动画收尾后清掉残留的 transform。带 transform 的元素会成为其
      // position:fixed 后代的包含块（fixed 相对它而非视口定位）——音乐页底部常驻
      // 播放器就是 fixed，被顶出视口而看不见。清理后元素回到无 transform 状态。
      clearProps: 'transform',
      scrollTrigger: once ? { trigger: el, start: 'top 88%', once: true } : undefined,
    },
  )
}

export { gsap, ScrollTrigger }
