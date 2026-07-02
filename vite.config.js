import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    // 路径别名（path alias） 做映射，方便你在项目里用短路径写 import。所以 @ ≈ 项目根目录/src
    // import Map from '@/components/map.vue'
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
})
