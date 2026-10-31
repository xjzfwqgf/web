import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/', name: 'home', component: () => import('../views/Home.vue') },
  { path: '/video/:id', name: 'play', component: () => import('../views/Play.vue') },
  { path: '/collection/:id', name: 'collection', component: () => import('../views/Collection.vue') },
  { path: '/search', name: 'search', component: () => import('../views/Search.vue') },
  { path: '/music', name: 'music', component: () => import('../views/Music.vue'), meta: { auth: true } },
  { path: '/category/:name', name: 'category', component: () => import('../views/Category.vue') },
  { path: '/upload', name: 'upload', component: () => import('../views/Upload.vue'), meta: { admin: true } },
  { path: '/user', name: 'user', component: () => import('../views/UserCenter.vue'), meta: { auth: true } },
  { path: '/login', name: 'login', component: () => import('../views/Login.vue') },
  { path: '/register', name: 'register', component: () => import('../views/Register.vue') },
  {
    path: '/admin',
    component: () => import('../views/admin/AdminLayout.vue'),
    meta: { admin: true },
    children: [
      { path: '', name: 'admin-dashboard', component: () => import('../views/admin/Dashboard.vue') },
      { path: 'users', name: 'admin-users', component: () => import('../views/admin/Users.vue') },
      { path: 'videos', name: 'admin-videos', component: () => import('../views/admin/Videos.vue') },
      { path: 'collections', name: 'admin-collections', component: () => import('../views/admin/Collections.vue') },
      { path: 'comments', name: 'admin-comments', component: () => import('../views/admin/Comments.vue') },
      { path: 'danmaku', name: 'admin-danmaku', component: () => import('../views/admin/Danmaku.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  // 仅路径变化时滚到顶部；query-only 导航（如播放页 ?t= 进度更新）不滚动
  scrollBehavior(to, from, savedPosition) {
    if (to.path === from.path) return {}
    return savedPosition || { top: 0 }
  },
})

const loggedIn = () => !!localStorage.getItem('token')
const isAdmin = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null')?.role === 'admin'
  } catch {
    return false
  }
}

router.beforeEach((to) => {
  if (to.meta.auth && !loggedIn()) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.meta.admin && !(loggedIn() && isAdmin())) {
    return { name: 'home' }
  }
  if ((to.name === 'login' || to.name === 'register') && loggedIn()) {
    return { name: 'home' }
  }
})

export default router
