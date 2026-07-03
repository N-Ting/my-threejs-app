<!-- @format --> <!-- Prettier 格式化标记 -->

<template>
  <!-- Three.js 渲染容器，WebGL 画布与 CSS2D 标签层均挂载于此 -->
  <div id="map"></div> <!-- 地图挂载点，id 供 getElementById 使用 -->
</template>

<script setup>
import { onMounted } from "vue"; // Vue 组合式 API：组件挂载后执行初始化
import * as THREE from "three"; // Three.js 核心库，用于 3D 场景渲染
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"; // 轨道控制器：拖拽旋转/缩放
import * as d3 from "d3"; // D3.js：地理投影，将经纬度转为平面坐标
import {
  CSS2DRenderer, // CSS2D 渲染器：在 3D 场景上叠加 HTML 标签
  CSS2DObject, // CSS2D 对象：将 DOM 元素绑定到 3D 坐标
} from "three/examples/jsm/renderers/CSS2DRenderer.js";
import guangzhouGeojson from "@/utils/guangzhou.json"; // 广州市 GeoJSON 本地数据（Vite 自动解析为对象）

onMounted(() => { // 组件挂载到 DOM 后开始初始化 Three.js
  // ============ 1. 场景 ============
  const scene = new THREE.Scene(); // 创建场景，作为所有 3D 对象的根容器

  // ============ 2. 灯光 ============
  const ambientLight = new THREE.AmbientLight(0xd4e7fd, 4); // 环境光：颜色 #d4e7fd，强度 4
  scene.add(ambientLight); // 将环境光加入场景

  const directionalLight = new THREE.DirectionalLight(0xe8eaeb, 0.2); // 平行光 1：模拟太阳光，强度 0.2
  directionalLight.position.set(0, 10, 5); // 设置光源位置：场景前上方
  const directionalLight2 = directionalLight.clone(); // 克隆平行光 2，复用同一配置
  directionalLight2.position.set(0, 10, -5); // 光源位置：场景后上方
  const directionalLight3 = directionalLight.clone(); // 克隆平行光 3
  directionalLight3.position.set(5, 10, 0); // 光源位置：场景右上方
  const directionalLight4 = directionalLight.clone(); // 克隆平行光 4
  directionalLight4.position.set(-5, 10, 0); // 光源位置：场景左上方
  scene.add(directionalLight, directionalLight2, directionalLight3, directionalLight4); // 四向平行光加入场景，增强立体感

  // ============ 3. 相机 ============
  const camera = new THREE.PerspectiveCamera(
    55, // 视野角度 FOV（度）
    window.innerWidth / window.innerHeight, // 宽高比，与窗口一致
    0.1, // 近裁剪面：距离相机多近开始渲染
    10000, // 远裁剪面：距离相机多远停止渲染
  );
  camera.position.y = 4; // 相机 Y 坐标：从上方俯视
  camera.position.z = 4; // 相机 Z 坐标：从斜前方观察地图

  // ============ 4. CSS2D 标签渲染器 ============
  const labelRenderer = new CSS2DRenderer(); // 创建 HTML 标签专用渲染器
  labelRenderer.domElement.style.position = "absolute"; // 标签层绝对定位，覆盖在 canvas 上
  labelRenderer.domElement.style.top = "0px"; // 标签层顶部对齐容器
  labelRenderer.domElement.style.pointerEvents = "none"; // 标签不拦截鼠标，便于 OrbitControls 操作
  labelRenderer.setSize(window.innerWidth, window.innerHeight); // 标签层尺寸与窗口一致
  document.getElementById("map").appendChild(labelRenderer.domElement); // 将标签层 DOM 挂到 #map

  // ============ 5. WebGL 渲染器 ============
  const renderer = new THREE.WebGLRenderer({ alpha: true }); // WebGL 渲染器，alpha 透明背景
  renderer.toneMapping = THREE.NoToneMapping; // 关闭色调映射，避免 r155+ 默认 ACES 压暗颜色
  renderer.setSize(window.innerWidth, window.innerHeight); // canvas 尺寸与窗口一致
  document.getElementById("map").appendChild(renderer.domElement); // 将 WebGL canvas 挂到 #map

  const controls = new OrbitControls(camera, renderer.domElement); // 轨道控制器，绑定相机与 canvas
  controls.update(); // 初始化控制器内部状态

  // ============ 6. 渲染循环 ============
  const animate = () => { // 定义每帧执行的动画函数
    requestAnimationFrame(animate); // 浏览器下一帧再次调用 animate，形成循环
    controls.update(); // 更新控制器（阻尼、自动旋转等）
    renderer.render(scene, camera); // WebGL 渲染 3D 场景
    labelRenderer.render(scene, camera); // CSS2D 同步渲染 HTML 标签
  };
  animate(); // 启动渲染循环

  // ============ 7. 响应式 ============
  window.addEventListener("resize", () => { // 监听窗口尺寸变化
    camera.aspect = window.innerWidth / window.innerHeight; // 更新相机宽高比
    camera.updateProjectionMatrix(); // 宽高比变化后必须更新投影矩阵
    renderer.setSize(window.innerWidth, window.innerHeight); // 同步 WebGL canvas 尺寸
    labelRenderer.setSize(window.innerWidth, window.innerHeight); // 同步 CSS2D 层尺寸
  });

  // ============ 8. 构建并添加地图 ============
  const map = createMap(guangzhouGeojson); // 根据 GeoJSON 构建 3D 地图组
  scene.add(map); // 将地图加入场景

  // ============ 9. 点击交互：射线检测高亮选中区域 ============
  let intersect = null; // 记录当前选中的区县容器 unit
  window.addEventListener("pointerdown", (event) => { // 监听鼠标/触摸按下
    const mouse = new THREE.Vector2(); // 二维向量，存储 NDC 坐标
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1; // 屏幕 X → NDC [-1, 1]
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1; // 屏幕 Y → NDC（Y 轴翻转）

    const raycaster = new THREE.Raycaster(); // 射线检测器，用于判断点击命中哪个 3D 对象
    raycaster.setFromCamera(mouse, camera); // 从相机位置沿鼠标方向发射射线
    const intersects = raycaster
      .intersectObjects(map.children, true) // 递归检测 map 下所有子对象（含 unit 内 Mesh）
      .filter((item) => item.object.type !== "Line"); // 过滤边界线，只保留 Mesh / Sprite

    if (intersects.length > 0) { // 有命中对象
      if (intersects[0].object.type === "Mesh") { // 点击到区县 mesh
        if (intersect) setUnitOpacity(intersect, 1); // 恢复上一个选中区县的透明度
        intersect = intersects[0].object.parent; // 取 mesh 的父级 unit 作为选中区域
        setUnitOpacity(intersect, 0.4); // 当前区县设为半透明高亮
      }
      if (intersects[0].object.type === "Sprite") { // 点击到定位图标
        console.log(intersects[0].object); // 打印 sprite 对象（调试用）
      }
    } else { // 未命中任何对象（点击空白）
      if (intersect) setUnitOpacity(intersect, 1); // 取消高亮，恢复不透明
    }

    function setUnitOpacity(unit, opacity) { // 修改区县容器下所有 mesh 的透明度
      unit.children.forEach((item) => { // 遍历 unit 的子对象
        if (item.type === "Mesh") { // 只处理网格，跳过 Line 等
          item.material.opacity = opacity; // 设置材质透明度（需 transparent: true）
        }
      });
    }
  });
});

const offsetXY = d3.geoMercator(); // 创建墨卡托投影实例，用于经纬度 → 平面坐标

/**
 * 根据 GeoJSON 创建 3D 地图组
 * 每个 feature 对应一个区县，包含挤出网格、边界线、文字标签和图标
 */
const createMap = (data) => { // data：FeatureCollection 格式的 GeoJSON
  const map = new THREE.Object3D(); // 地图根容器，包含所有区县

  const center = data.features[0].properties.centroid; // 取第一个区县质心作为投影中心
  offsetXY.center(center).translate([0, 0]); // 配置投影：中心点映射到 (0,0)

  data.features.forEach((feature) => { // 遍历每个区县 feature
    const unit = new THREE.Object3D(); // 单个区县的容器对象
    const { centroid, name } = feature.properties; // 解构：质心坐标、区县名称
    const { coordinates, type } = feature.geometry; // 解构：坐标数组、几何类型
    const point = centroid || [0, 0]; // 标签/图标定位点，无 centroid 时用原点

    const color = new THREE.Color(`hsl(
      ${233},
      ${Math.random() * 30 + 55}%,
      ${Math.random() * 30 + 55}%)`).getHex(); // 随机蓝紫色（HSL 233°），转十六进制
    const depth = Math.random() * 0.3 + 0.3; // 随机挤出高度 0.3~0.6，形成高低起伏

    const label = createLabel(name, point, depth); // 创建区县名称 HTML 标签
    const icon = createIcon(centroid, depth); // 创建区县中心定位图标

    coordinates.forEach((coordinate) => { // 遍历几何坐标（MultiPolygon / Polygon 结构不同）
      if (type === "MultiPolygon") coordinate.forEach((item) => fn(item)); // 多多边形：每个 polygon 单独处理
      if (type === "Polygon") fn(coordinate); // 单 polygon：直接处理外环

      function fn(ring) { // ring：单个多边形外环 [[lng,lat], ...]
        unit.name = name; // 设置 unit 名称为区县名，便于调试
        const mesh = createMesh(ring, color, depth); // 创建挤出 3D 区块
        const line = createLine(ring, depth); // 创建顶底白色边界线
        unit.add(mesh, ...line); // 将 mesh 和两条线加入区县容器
      }
    });

    map.add(unit, label, icon); // 将区县容器、标签、图标加入地图根节点
    setCenter(map); // 旋转地图到地面并居中（每加一个区县后更新）
  });

  return map; // 返回完整地图 Object3D
};

/**
 * 将 GeoJSON 环坐标挤出为 3D 区块
 * @param {Array} data - 单个 polygon 环，形如 [[lng, lat], ...]
 * @param {number} color - 顶面十六进制颜色
 * @param {number} depth - 挤出深度（厚度）
 */
const createMesh = (data, color, depth) => { // 根据环坐标创建 ExtrudeGeometry mesh
  const shape = new THREE.Shape(); // Three.js 二维形状，用于挤出

  data.forEach((item, idx) => { // 遍历环上每个经纬度点
    const [x, y] = offsetXY(item); // 墨卡托投影： [lng,lat] → [x,y]
    if (idx === 0) shape.moveTo(x, -y); // 第一个点：移动到起点（y 取负翻转坐标系）
    else shape.lineTo(x, -y); // 后续点：连线到当前位置
  });

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth, // 沿 Z 轴挤出深度
    bevelEnabled: false, // 关闭倒角，保持边缘垂直
  });
  const material = new THREE.MeshStandardMaterial({
    color, // 顶面/侧面颜色
    emissive: 0x000000, // 自发光颜色（黑色 = 不发光）
    roughness: 0.45, // 粗糙度，影响反光散射
    metalness: 0.8, // 金属度，影响镜面反射
    transparent: true, // 开启透明，配合点击 opacity 变化
    side: THREE.DoubleSide, // 双面渲染，避免背面不可见
  });

  return new THREE.Mesh(geometry, material); // 组合几何体与材质，返回可渲染网格
};

/**
 * 创建区域顶面与底面的白色边界线
 * 通过微小 z 偏移避免与 Mesh 面片 Z-fighting 闪烁
 */
const createLine = (data, depth) => { // 根据环坐标创建顶底边界线
  const points = []; // 存储三维顶点数组
  data.forEach((item) => { // 遍历环上每个点
    const [x, y] = offsetXY(item); // 经纬度投影为平面坐标
    points.push(new THREE.Vector3(x, -y, 0)); // 转为 Three.js 三维点（底面 z=0）
  });
  const lineGeometry = new THREE.BufferGeometry().setFromPoints(points); // 由点集创建线几何体
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff }); // 白色线条材质

  const upLine = new THREE.Line(lineGeometry, lineMaterial); // 顶面边界线
  const downLine = new THREE.Line(lineGeometry, lineMaterial.clone()); // 底面边界线（独立材质实例）
  downLine.position.z = -0.0001; // 底面线略低于 z=0，避免与 mesh 共面闪烁
  upLine.position.z = depth + 0.0001; // 顶面线略高于挤出高度，同样防闪烁
  return [upLine, downLine]; // 返回顶线、底线数组
};

/** 创建 CSS2D 文字标签，显示区县名称 */
const createLabel = (name, point, depth) => { // name：区县名；point：质心；depth：挤出高度
  const div = document.createElement("div"); // 创建 HTML div 作为标签载体
  div.style.color = "#fff"; // 文字颜色：白色
  div.style.fontSize = "12px"; // 字号 12px
  div.style.textShadow = "1px 1px 2px #047cd6"; // 蓝色阴影，提高可读性
  div.textContent = name; // 设置显示文本为区县名称

  const label = new CSS2DObject(div); // 将 div 包装为 Three.js CSS2D 对象
  label.scale.set(0.01, 0.01, 0.01); // 缩小标签，适配 3D 场景比例
  const [x, y] = offsetXY(point); // 质心经纬度 → 投影坐标
  label.position.set(x, -y, depth); // 标签位置：区县质心上方，高度与挤出顶面齐平
  return label; // 返回可加入场景的 CSS2D 标签
};

/** 在区县质心上方创建 Sprite 定位图标 */
const createIcon = (point, depth) => { // point：质心坐标；depth：挤出高度
  const url = new URL("../assets/icon.png", import.meta.url).href; // Vite 解析图标资源 URL
  const texture = new THREE.TextureLoader().load(url); // 异步加载 PNG 纹理
  const material = new THREE.SpriteMaterial({
    map: texture, // 将纹理贴到 Sprite
    transparent: true, // 支持 PNG 透明通道
  });

  const sprite = new THREE.Sprite(material); // 创建始终面向相机的 2D 精灵
  const [x, y] = offsetXY(point); // 质心投影坐标
  sprite.scale.set(0.3, 0.3, 0.3); // 图标缩放比例
  sprite.position.set(x, -y, depth + 0.2); // 位置：质心上方，略高于区块顶面
  sprite.renderOrder = 1; // 渲染顺序大于 0，保证绘制在 mesh 之上

  return sprite; // 返回定位图标
};

/**
 * 将地图组旋转到 XZ 地面，并平移使几何中心对齐场景原点
 * ExtrudeGeometry 默认在 XY 平面沿 Z 挤出，绕 X 轴 -90° 后变为平铺在地面
 */
const setCenter = (map) => { // map：整个地图 Object3D
  map.rotation.x = -Math.PI / 2; // 绕 X 轴旋转 -90°，地图从竖直变为水平（XZ 平面）

  const box = new THREE.Box3().setFromObject(map); // 计算地图包围盒
  const center = box.getCenter(new THREE.Vector3()); // 获取包围盒几何中心
  map.position.x -= center.x; // X 方向平移，使中心对齐原点
  map.position.z -= center.z; // Z 方向平移，使中心对齐原点
};
</script>

<style scoped>
/* scoped：样式仅作用于当前组件 */
#map {
  background-color: #d4e7fd; /* 页面背景色，与 canvas 透明区域配合显示 */
}
</style>
