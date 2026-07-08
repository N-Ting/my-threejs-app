//router
import { createRouter, createWebHistory } from 'vue-router'
import TianMap from '../components/TianMap.vue'
import AliYunMap from '../components/AliYunMap.vue'
import ThreeDTianMap from '../components/ThreeDTianMap.vue'
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
  },
  {
    path: '/3d-tianditu-map',
    name: '3d-tianditu-map',
    component: ThreeDTianMap
  }

]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router