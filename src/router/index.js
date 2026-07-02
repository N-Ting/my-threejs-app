//router
import { createRouter, createWebHistory } from 'vue-router'
import TianMap from '../components/TianMap.vue'
import AliYunMap from '../components/AliYunMap.vue'

const routes = [
  {
    path: '/tianditu-map',
    name: 'tianditu-map',
    component: TianMap
  },
  {
    path: '/aliyun-map',
    name: 'aliyun-map',
    component: AliYunMap
  }

]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router