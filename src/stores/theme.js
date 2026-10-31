import { defineStore } from 'pinia'
import { ref } from 'vue'

const STORAGE_KEY = 'theme'

// 应用到 <html>：data-theme 控制本站设计系统变量，dark class 控制 Element Plus 暗色变量。
// 注意 main.css 的 :root 默认就是浅色值，暗色由 html[data-theme='dark'] 覆盖。
export function applyTheme(theme) {
  const root = document.documentElement
  root.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark')
  root.classList.toggle('dark', theme !== 'light')
}

export const useThemeStore = defineStore('theme', () => {
  const theme = ref(localStorage.getItem(STORAGE_KEY) || 'light')

  function setTheme(t) {
    theme.value = t === 'light' ? 'light' : 'dark'
    localStorage.setItem(STORAGE_KEY, theme.value)
    applyTheme(theme.value)
  }

  function toggle() {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  return { theme, setTheme, toggle }
})
