import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 跨组件触发音乐页的管理动作。
 *
 * 绑定酷狗 / 同步「我喜欢」/ 解绑原本是音乐页标题区的一排按钮，
 * 因为常驻会把 Apple Music 的干净版式打回后台管理系统，收进了右上角头像菜单。
 * 菜单在 NavBar、真正的状态与弹窗在 Music.vue，所以用一个极小的 store 传话：
 *   pending = 'bind' | 'sync' | 'unbind'，音乐页消费后置空。
 */
export const useMusicToolsStore = defineStore('musicTools', () => {
  const pending = ref('')
  // 酷狗是否已绑定：null=还没查到，true/false=已确认
  const kgBound = ref(null)

  function request(action) {
    pending.value = action
  }

  function consume() {
    const action = pending.value
    pending.value = ''
    return action
  }

  return { pending, kgBound, request, consume }
})
