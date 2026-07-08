<!-- @format -->

<template>
  <!-- 基于天地图做的 3D 地图 + 柱状图 -->
  <div id="map"></div>
  <!-- Three.js 渲染容器，WebGL / CSS3D / CSS2D 层均挂载于此 -->
  <button
    v-if="showBackButton"
    class="back-btn"
    type="button"
    @click="handleBack"
  >
    返回上一级
  </button>
</template>

<script setup>
import { onMounted, ref } from "vue"; // Vue 组合式 API
import * as THREE from "three"; // Three.js 核心库，用于 3D 场景渲染
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"; // 轨道控制器：拖拽旋转/缩放
import {
  CSS3DRenderer, // CSS3D 渲染器：用于 HTML 元素参与 3D 变换
  CSS3DObject, // CSS3D 对象：将 DOM 元素绑定到 3D 坐标
} from "three/examples/jsm/renderers/CSS3DRenderer.js";
import {
  CSS2DRenderer, // CSS2D 渲染器：标签始终朝向相机
  CSS2DObject, // CSS2D 对象：将 DOM 元素绑定到 3D 坐标（本文件未使用）
} from "three/examples/jsm/renderers/CSS2DRenderer.js";
import * as d3 from "d3"; // D3.js：地理投影，将经纬度转为平面坐标
import guangzhouGeojson from "@/utils/guangzhou.json"; // 广州市 GeoJSON 本地数据

const mapStyle = {
  // 地图全局样式配置对象
  deep: 0.3, // 区块挤出厚度
  planeColor: "#257eb8", // 顶面默认颜色
  sideColor: "#052948", // 侧面默认颜色
  lineColor: "#78cfff", // 边界线颜色
  hoverPlaneColor: "#3ab4ff", // 鼠标悬停时顶面高亮颜色
  hoverSideColor: "#0d5a8f", // 鼠标悬停时侧面高亮颜色
  barColor: 0x5fd5e1, // 柱状图主体颜色 #5fd5e1
  barEmissive: 0x2d8a96, // 柱体自发光颜色
  barGlowColor: 0xe0f9fc, // 内层发光颜色（柔和青白）
  barRadius: 0.042, // 柱体外径（六棱柱）
  barCoreRadius: 0.006, // 柱体中心光柱半径
  barOpacity: 0.52, // 柱体主体透明度
  barCoreOpacity: 0.55, // 内层光柱基础透明度
  barEmissiveIntensity: 0.35, // 柱体自发光强度
  barLightWidth: 0.045, // 柱体内部交叉发光平面宽度
  barLightOpacity: 0.28, // 交叉发光平面透明度
  barTopOpacity: 0.55, // 柱顶辉光透明度
  labelBarGap: 0.08, // 标签与柱顶间距
  barRingOuterSize: 0.24, // 柱底外圈光圈尺寸
  barRingInnerSize: 0.2, // 柱底内圈光圈尺寸
  huiguangTexture: null, // 垂直辉光渐变纹理（运行时赋值）
  glowRadialTexture: null, // 顶部径向辉光纹理（运行时赋值）
  guangquan01: null, // 柱底外圈贴图（运行时赋值）
  guangquan02: null, // 柱底内圈贴图（运行时赋值）
  rotationBorder1: null, // 地图底部大光圈贴图 dibuguangquan1.webp
  rotationBorder2: null, // 地图底部小光圈贴图 dibuguangquan2.webp
  bottomCircleColor: 0x2aa8ac, // 底部光圈着色 #2aa8ac
  bottomCircleOpacity: 0.2, // 底部光圈透明度
  pointTexture: null, // 定位图标贴图（运行时赋值）
  iconBaseMaterial: null, // 图标共享基础材质（预留）
  iconSize: 0.15, // 图标缩放尺寸
  iconColors: [0x5fd5e1, 0xffffff], // 图标交替颜色
  iconDepthOffset: 0.02, // 图标相对地图顶面的高度偏移
};
const offsetXY = d3.geoMercator(); // 墨卡托投影实例：经纬度 → 平面坐标
const vertices = []; // 存储地图 mesh 顶点，用于计算包围盒
let clickMesh = []; // 可交互物体集合（勿用 ref，避免 Vue 代理 Three.js 对象）
let barCircles = []; // 柱底旋转光圈集合
let mapBottomCircles = []; // 地图底部旋转光圈集合
let animatedPoints = []; // 需浮动动画的 Sprite 图标集合
let mapObject = null; // 当前地图 Object3D 引用
let allDistrictEntries = []; // 各区县数据包：用于下钻显示/隐藏
let mapDecor = { titleLabel: null, bottomLight: null }; // 底部标题与光圈装饰
let navigateBack = null; // 返回广州市视图的回调（initScene 内赋值）
let currentMapLevel = "city"; // 当前层级：city 广州市 / district 区县
const showBackButton = ref(false); // 是否显示「返回上一级」按钮

/** 点击返回上一级，回到广州市全景 */
const handleBack = () => {
  navigateBack?.(); // 调用场景内重建地图方法
};

/** 根据数据值计算柱体高度 */
const getBarHeight = (value) => value * 0.015 + 0.15; // 线性映射：值越大柱越高

onMounted(() => {
  initScene(); // 组件挂载后初始化 Three.js 场景
});

/** 加载 webp 贴图并遮盖右下角水印（当前未使用，保留备用） */
const loadCleanWebpTexture = (url) =>
  new Promise((resolve) => {
    const image = new Image(); // 创建图片对象
    image.onload = () => {
      const canvas = document.createElement("canvas"); // 创建画布处理贴图
      const width = image.width; // 原图宽度
      const height = image.height; // 原图高度
      canvas.width = width; // 设置画布宽
      canvas.height = height; // 设置画布高
      const ctx = canvas.getContext("2d"); // 获取 2D 绘图上下文
      ctx.drawImage(image, 0, 0, width, height); // 绘制原图
      ctx.fillStyle = "#000000"; // 黑色遮盖水印区域
      ctx.fillRect(
        Math.floor(width * 0.55), // 水印区起始 X
        Math.floor(height * 0.88), // 水印区起始 Y
        Math.floor(width * 0.45), // 遮盖宽度
        Math.floor(height * 0.12), // 遮盖高度
      );
      const texture = new THREE.CanvasTexture(canvas); // 转为 Three.js 纹理
      texture.colorSpace = THREE.SRGBColorSpace; // 使用 sRGB 色彩空间
      resolve(texture); // 返回处理后的纹理
    };
    image.onerror = () => {
      console.warn("底部光圈贴图加载失败:", url); // 加载失败警告
      resolve(null); // 返回 null 避免阻塞
    };
    image.src = url; // 开始加载图片
  });

/** 初始化 Three.js 场景、渲染器、交互与地图 */
const initScene = async () => {
  const scene = new THREE.Scene(); // 创建场景根容器

  // ============ 灯光 ============
  const ambientLight = new THREE.AmbientLight(0xd4e7fd, 4); // 环境光：全局基础照明
  scene.add(ambientLight); // 加入场景

  const directionalLight = new THREE.DirectionalLight(0xe8eaeb, 0.2); // 平行光 1
  directionalLight.position.set(0, 10, 5); // 前上方
  const directionalLight2 = directionalLight.clone(); // 平行光 2
  directionalLight2.position.set(0, 10, -5); // 后上方
  const directionalLight3 = directionalLight.clone(); // 平行光 3
  directionalLight3.position.set(5, 10, 0); // 右上方
  const directionalLight4 = directionalLight.clone(); // 平行光 4
  directionalLight4.position.set(-5, 10, 0); // 左上方
  scene.add(
    directionalLight, // 加入平行光 1
    directionalLight2, // 加入平行光 2
    directionalLight3, // 加入平行光 3
    directionalLight4, // 加入平行光 4
  );

  // ============ 相机 ============
  const camera = new THREE.PerspectiveCamera(
    55, // 视野角度 FOV
    window.innerWidth / window.innerHeight, // 宽高比
    0.1, // 近裁剪面
    10000, // 远裁剪面
  );
  camera.position.y = 4; // 相机 Y：俯视角度
  camera.position.z = 4; // 相机 Z：斜前方观察

  // ============ WebGL 渲染器 ============
  const renderer = new THREE.WebGLRenderer({
    alpha: true, // 透明背景
    antialias: true, // 抗锯齿
  });
  renderer.toneMapping = THREE.NoToneMapping; // 关闭色调映射
  renderer.setPixelRatio(window.devicePixelRatio); // 适配高分屏
  renderer.setSize(window.innerWidth, window.innerHeight); // 设置画布尺寸
  renderer.domElement.style.position = "absolute"; // 绝对定位
  renderer.domElement.style.top = "0"; // 顶部对齐
  renderer.domElement.style.left = "0"; // 左侧对齐
  renderer.domElement.style.zIndex = "1"; // WebGL 最底层
  document.getElementById("map").appendChild(renderer.domElement); // 挂载 canvas

  // ============ CSS3D 渲染器 ============
  const css3DRenderer = new CSS3DRenderer(); // 创建 CSS3D 渲染器
  css3DRenderer.setSize(window.innerWidth, window.innerHeight); // 设置层尺寸
  css3DRenderer.domElement.style.position = "absolute"; // 绝对定位
  css3DRenderer.domElement.style.top = "0"; // 顶部对齐
  css3DRenderer.domElement.style.left = "0"; // 左侧对齐
  css3DRenderer.domElement.style.pointerEvents = "none"; // 不拦截鼠标
  css3DRenderer.domElement.style.zIndex = "2"; // 在 WebGL 之上
  document.getElementById("map").appendChild(css3DRenderer.domElement); // 挂载 DOM

  // ============ CSS2D 标签渲染器 ============
  const labelRenderer = new CSS2DRenderer(); // 创建 CSS2D 渲染器
  labelRenderer.setSize(window.innerWidth, window.innerHeight); // 设置层尺寸
  labelRenderer.domElement.style.position = "absolute"; // 绝对定位
  labelRenderer.domElement.style.top = "0"; // 顶部对齐
  labelRenderer.domElement.style.left = "0"; // 左侧对齐
  labelRenderer.domElement.style.pointerEvents = "none"; // 不拦截鼠标
  labelRenderer.domElement.style.zIndex = "3"; // 最上层
  document.getElementById("map").appendChild(labelRenderer.domElement); // 挂载 DOM

  // ============ 轨道控制器 ============
  const controls = new OrbitControls(camera, renderer.domElement); // 绑定相机与画布
  controls.update(); // 初始化控制器

  // ============ 渲染循环 ============
  const animate = () => {
    requestAnimationFrame(animate); // 下一帧继续执行
    controls.update(); // 更新轨道控制器
    barCircles.forEach((ring, index) => {
      ring.rotation.z += index % 2 === 0 ? 0.02 : -0.015; // 柱底光圈：偶数顺时针、奇数逆时针
    });
    mapBottomCircles.forEach((ring, index) => {
      ring.rotation.z += index % 2 === 0 ? 0.003 : -0.008; // 地图底部光圈：反向旋转
    });
    const time = performance.now() * 0.002; // 动画时间因子
    animatedPoints.forEach((sprite, index) => {
      sprite.position.z = sprite.userData.baseZ + Math.sin(time + index) * 0.03; // 图标上下浮动
      const scale =
        sprite.userData.baseSize * (1 + Math.sin(time * 1.5 + index) * 0.08); // 图标呼吸缩放
      sprite.scale.set(scale, scale, scale); // 应用缩放
    });
    renderer.render(scene, camera); // WebGL 渲染
    css3DRenderer.render(scene, camera); // CSS3D 渲染
    labelRenderer.render(scene, camera); // CSS2D 渲染
  };
  animate(); // 启动渲染循环

  // ============ 响应式 ============
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight; // 更新相机宽高比
    camera.updateProjectionMatrix(); // 更新投影矩阵
    renderer.setSize(window.innerWidth, window.innerHeight); // 同步 WebGL 尺寸
    css3DRenderer.setSize(window.innerWidth, window.innerHeight); // 同步 CSS3D 尺寸
    labelRenderer.setSize(window.innerWidth, window.innerHeight); // 同步 CSS2D 尺寸
  });

  // ============ 构建并添加地图 ============
  mapStyle.huiguangTexture = createHuiguangTexture(); // 柱体垂直辉光纹理
  mapStyle.glowRadialTexture = createGlowRadialTexture(); // 柱顶径向辉光纹理
  const textureLoader = new THREE.TextureLoader(); // 贴图加载器
  mapStyle.guangquan01 = textureLoader.load(
    new URL("../assets/guangquan1.webp", import.meta.url).href,
  ); // 柱底外圈贴图
  mapStyle.guangquan02 = textureLoader.load(
    new URL("../assets/guangquan2.webp", import.meta.url).href,
  ); // 柱底内圈贴图
  mapStyle.rotationBorder1 = textureLoader.load(
    new URL("../assets/dibuguangquan1.webp", import.meta.url).href,
  ); // 地图底部大光圈贴图
  mapStyle.rotationBorder2 = textureLoader.load(
    new URL("../assets/dibuguangquan2.webp", import.meta.url).href,
  ); // 地图底部小光圈贴图
  mapStyle.pointTexture = textureLoader.load(
    new URL("../assets/icon.png", import.meta.url).href,
  ); // 区县图标贴图

  clickMesh = []; // 重置可交互物体
  barCircles = []; // 重置柱底光圈
  mapBottomCircles = []; // 重置地图底部光圈
  animatedPoints = []; // 重置动画图标
  let hoveredUnit = null; // 当前悬停的区县容器

  /** 切换地图视图：隐藏非当前区县，返回时全部显示 */
  const switchMapView = (districtName = null) => {
    const isDistrictView = Boolean(districtName); // 是否区县下钻
    currentMapLevel = isDistrictView ? "district" : "city"; // 更新层级
    showBackButton.value = isDistrictView; // 控制返回按钮

    allDistrictEntries.forEach((entry) => {
      entry.bundle.visible = !isDistrictView || entry.name === districtName; // 隐藏其他区县
    });

    refreshActiveCollections(districtName); // 刷新交互与动画集合（仅当前可见）
    focusMapView(districtName); // 重新居中视野
    updateMapDecor(districtName); // 更新底部标题与光圈位置
    hoveredUnit = null; // 清空悬停
    renderer.domElement.style.cursor = "default"; // 恢复光标
  };

  /** 仅收集当前可见区县的交互对象与动画对象 */
  const refreshActiveCollections = (districtName = null) => {
    clickMesh = []; // 重置可点击集合
    barCircles = []; // 重置柱底光圈动画
    animatedPoints = []; // 重置图标动画
    mapBottomCircles = []; // 重置底部光圈动画

    allDistrictEntries.forEach((entry) => {
      if (districtName && entry.name !== districtName) return; // 跳过隐藏区县
      entry.clickTargets.forEach((target) => clickMesh.push(target)); // 网格/柱体
      entry.barRings.forEach((ring) => barCircles.push(ring)); // 柱底光圈
      entry.sprites.forEach((sprite) => animatedPoints.push(sprite)); // 图标
    });

    mapDecor.bottomLight?.children.forEach((ring) => {
      if (ring.isMesh) mapBottomCircles.push(ring); // 底部大光圈始终参与动画
    });
  };

  /** 根据当前视图重新居中地图（仅以区县 bundle 计算，不含底部装饰） */
  const focusMapView = (districtName = null) => {
    mapObject.rotation.x = -Math.PI / 2; // 保持地图平躺
    mapObject.position.set(0, 0, 0); // 重置位移

    const box = new THREE.Box3(); // 可见区县包围盒
    const tempBox = new THREE.Box3(); // 单区县临时包围盒

    allDistrictEntries.forEach((entry) => {
      if (districtName && entry.name !== districtName) return; // 下钻时仅当前区县
      tempBox.setFromObject(entry.bundle); // 计算区县包围盒
      box.union(tempBox); // 合并到总包围盒
    });

    if (box.isEmpty()) return; // 无有效包围盒则跳过

    const center = box.getCenter(new THREE.Vector3()); // 包围盒中心
    mapObject.position.x -= center.x; // X 居中
    mapObject.position.z -= center.z; // Z 居中
  };

  /** 更新底部标题文案与光圈位置 */
  const updateMapDecor = (districtName = null) => {
    const isDistrictView = Boolean(districtName);
    const titleCn = isDistrictView ? districtName : "广州";
    const titleEn = isDistrictView
      ? districtName.replace(/[区县市]/g, "").toUpperCase()
      : "GUANGZHOU";
    const bounds = isDistrictView
      ? allDistrictEntries.find((entry) => entry.name === districtName)?.bounds
      : getCityBounds(); // 市级用全市包围盒

    if (!bounds) return; // 无包围盒数据则跳过

    if (mapDecor.titleLabel?.element) {
      const cnNode = mapDecor.titleLabel.element.querySelector(".country-cn");
      const enNode = mapDecor.titleLabel.element.querySelector(".country-en");
      if (cnNode) cnNode.textContent = titleCn; // 更新中文标题
      if (enNode) enNode.textContent = titleEn; // 更新英文标题
      mapDecor.titleLabel.position.set(
        bounds.centerX,
        bounds.minY - bounds.width * 0.12,
        mapStyle.deep + 0.02,
      );
    }

    if (mapDecor.bottomLight && bounds) {
      const mapSpan = Math.max(bounds.width, bounds.height, 0.1);
      const radius1 = mapSpan * 1.4;
      const radius2 = radius1 * (110 / 130);
      const [bigCirclePlane, smallCirclePlane] = mapDecor.bottomLight.children;
      if (bigCirclePlane) {
        bigCirclePlane.position.set(bounds.centerX, bounds.centerY, -0.01);
        bigCirclePlane.geometry.dispose();
        bigCirclePlane.geometry = new THREE.PlaneGeometry(radius1, radius1);
      }
      if (smallCirclePlane) {
        smallCirclePlane.position.set(bounds.centerX, bounds.centerY, -0.01);
        smallCirclePlane.geometry.dispose();
        smallCirclePlane.geometry = new THREE.PlaneGeometry(radius2, radius2);
      }
    }
  };

  mapObject = createMap(guangzhouGeojson); // 一次性构建全市地图
  scene.add(mapObject); // 加入场景

  navigateBack = () => switchMapView(null); // 返回广州市：显示全部区县
  switchMapView(null); // 初始为广州市全景

  // ============ 射线检测交互（悬停 + 点击） ============
  const raycaster = new THREE.Raycaster(); // 射线检测器
  const mouse = new THREE.Vector2(); // 鼠标 NDC 坐标

  /** 点击区县：市级视图下钻到区县，区县视图不处理 */
  const handleRegionClick = (message) => {
    if (currentMapLevel !== "city") return; // 已在区县视图，不再下钻
    if (message.event_type !== "mesh") return; // 仅点击地图区块下钻
    switchMapView(message.event_name); // 下钻：仅显示当前区县数据
  };

  /** 屏幕坐标转 NDC 并更新射线 */
  const updateRaycaster = (event) => {
    const x = event.clientX; // 鼠标视口 X
    const y = event.clientY; // 鼠标视口 Y
    mouse.x = (x / window.innerWidth) * 2 - 1; // 转 NDC X [-1,1]
    mouse.y = -(y / window.innerHeight) * 2 + 1; // 转 NDC Y（Y 轴翻转）
    raycaster.setFromCamera(mouse, camera); // 从相机发射射线
  };

  /** 修改区县 mesh 顶面/侧面颜色 */
  const setUnitColor = (unit, planeColor, sideColor) => {
    unit.children.forEach((child) => {
      if (child.type !== "Mesh") return; // 跳过非网格对象
      const materials = Array.isArray(child.material)
        ? child.material // 多材质数组
        : [child.material]; // 单材质转数组
      materials[0]?.color.set(planeColor); // 设置顶面颜色
      materials[1]?.color.set(sideColor); // 设置侧面颜色 1
      materials[2]?.color.set(sideColor); // 设置侧面颜色 2
    });
  };

  /** 获取鼠标悬停的区县容器 */
  const getHoveredUnit = (event) => {
    updateRaycaster(event); // 更新射线
    const intersects = raycaster.intersectObjects(clickMesh); // 检测 clickMesh
    return intersects.length > 0 ? intersects[0].object.userData.unit : null; // 返回区县 unit
  };

  renderer.domElement.addEventListener("pointermove", (event) => {
    const unit = getHoveredUnit(event); // 获取悬停区县
    if (unit === hoveredUnit) return; // 未变化则跳过

    if (hoveredUnit) {
      setUnitColor(hoveredUnit, mapStyle.planeColor, mapStyle.sideColor); // 恢复上一区县颜色
    }

    hoveredUnit = unit; // 更新悬停区县

    if (hoveredUnit) {
      setUnitColor(
        hoveredUnit, // 当前悬停区县
        mapStyle.hoverPlaneColor, // 高亮顶面
        mapStyle.hoverSideColor, // 高亮侧面
      );
      renderer.domElement.style.cursor = "pointer"; // 手型光标
    } else {
      renderer.domElement.style.cursor = "default"; // 默认光标
    }
  });

  renderer.domElement.addEventListener("pointerleave", () => {
    if (!hoveredUnit) return; // 无悬停则返回
    setUnitColor(hoveredUnit, mapStyle.planeColor, mapStyle.sideColor); // 恢复颜色
    hoveredUnit = null; // 清空悬停
    renderer.domElement.style.cursor = "default"; // 恢复光标
  });

  renderer.domElement.addEventListener("click", (event) => {
    updateRaycaster(event); // 更新射线
    const intersects = raycaster.intersectObjects(clickMesh); // 射线检测
    if (intersects && intersects.length > 0) {
      const firstObj = intersects[0]; // 最近交点
      const message = firstObj.object.userData; // 读取 userData
      handleRegionClick(message); // 触发点击回调
    }
  });
};

/** 根据 GeoJSON 特征计算区县包围范围 */
const computeDistrictBounds = (feature) => {
  let minX = Infinity; // 最小 X
  let maxX = -Infinity; // 最大 X
  let minY = Infinity; // 最小 Y
  let maxY = -Infinity; // 最大 Y
  const { coordinates, type } = feature.geometry; // 几何数据

  const processRing = (ring) => {
    ring.forEach((item, idx) => {
      if (idx === 0) return; // 首点与末点重复，跳过
      const [x, y] = offsetXY(item); // 投影坐标
      const px = x; // X
      const py = -y; // Y（与 mesh 一致取反）
      if (px < minX) minX = px; // 更新最小 X
      if (px > maxX) maxX = px; // 更新最大 X
      if (py < minY) minY = py; // 更新最小 Y
      if (py > maxY) maxY = py; // 更新最大 Y
    });
  };

  coordinates.forEach((coordinate) => {
    if (type === "MultiPolygon") coordinate.forEach((item) => processRing(item)); // 多多边形
    if (type === "Polygon") processRing(coordinate); // 单多边形
  });

  return {
    minX, // 最西侧
    maxX, // 最东侧
    minY, // 最南侧
    maxY, // 最北侧
    centerX: (minX + maxX) / 2, // 水平中心
    centerY: (minY + maxY) / 2, // 垂直中心
    width: maxX - minX, // 区县宽度
    height: maxY - minY, // 区县高度
  };
};

/** 根据 GeoJSON 创建 3D 地图组（全市一次构建，下钻时切换可见性） */
const createMap = (data) => {
  const map = new THREE.Object3D(); // 地图根容器
  allDistrictEntries = []; // 重置区县数据包
  vertices.length = 0; // 清空顶点缓存

  if (!data.features?.length) return map; // 无数据时返回空地图

  const center = data.features[0].properties.centroid; // 投影中心
  offsetXY.center(center).translate([0, 0]); // 质心映射到 (0,0)

  data.features.forEach((feature, index) => {
    const unit = new THREE.Object3D(); // 单个区县 mesh 容器
    const { centroid, center, name, gb } = feature.properties; // 解构区县属性
    const { coordinates, type } = feature.geometry; // 解构几何数据
    const barPoint = centroid || center || [0, 0]; // 柱图/图标定位点
    const labelPoint = center || centroid || [0, 0]; // 标签定位点
    const value = Math.floor(Math.random() * 60 + 20); // 模拟数据值
    const barHeight = getBarHeight(value); // 计算柱高
    const showBar = index % 2 === 0; // 偶数区县显示柱图，奇数显示图标

    const bundle = new THREE.Group(); // 区县数据包：mesh + 柱图/图标 + 标签
    bundle.name = name; // 区县名称

    const entry = {
      name, // 区县名
      bundle, // 区县组
      clickTargets: [], // 可点击对象（mesh / 柱体 / 图标）
      barRings: [], // 柱底光圈（动画用）
      sprites: [], // 图标精灵（动画用）
      bounds: computeDistrictBounds(feature), // 区县包围盒
    };

    let marker = null; // 柱图或图标标记
    let districtLabel = null; // 柱顶信息卡片

    if (showBar) {
      marker = createAreaBar(
        { name, centroid: barPoint, value },
        entry.clickTargets,
        entry.barRings,
      ); // 创建光柱
      districtLabel = createDistrictInfoLabel({
        name, // 区县名
        point: labelPoint, // 标签坐标
        depth: mapStyle.deep + barHeight + mapStyle.labelBarGap, // 标签高度
        value, // 数据值
        index, // 区县索引
      });
    } else {
      marker = createIcon(
        barPoint,
        { name, index },
        entry.clickTargets,
        entry.sprites,
      ); // 创建图标
    }

    coordinates.forEach((coordinate) => {
      if (type === "MultiPolygon") coordinate.forEach((item) => fn(item)); // 多多边形
      if (type === "Polygon") fn(coordinate); // 单多边形

      function fn(ring) {
        unit.name = name; // 设置区县名称
        const mesh = createMesh(ring); // 挤出 3D 区块
        mesh.userData.event_type = "mesh"; // 类型：网格
        mesh.userData.event_name = name; // 区县名称
        mesh.userData.gb = gb; // 行政区划代码
        mesh.userData.centroid = centroid; // 质心坐标
        mesh.userData.index = index; // 区县索引
        mesh.userData.unit = unit; // 所属区县容器
        entry.clickTargets.push(mesh); // 加入区县交互集合
        const line = createLine(ring); // 创建边界线
        unit.add(mesh, ...line); // mesh + 顶底线加入区县容器
      }
    });

    bundle.add(unit); // mesh 加入区县组
    if (marker) bundle.add(marker); // 柱图/图标加入区县组
    if (districtLabel) bundle.add(districtLabel); // 标签加入区县组
    map.add(bundle); // 区县组加入地图
    allDistrictEntries.push(entry); // 记录区县数据包
  });

  setCenter(map); // 全市地图旋转并居中

  mapDecor.titleLabel = createHtml3dLabel("广州", "GUANGZHOU"); // 底部标题
  map.add(mapDecor.titleLabel); // 加入地图

  mapDecor.bottomLight = createGuangzhouBottomLight(); // 底部双层光圈
  map.add(mapDecor.bottomLight); // 加入地图

  return map; // 返回地图组
};

/** 地图旋转到 XZ 地面并居中 */
const setCenter = (map) => {
  map.rotation.x = -Math.PI / 2; // 绕 X 轴 -90°，地图平躺

  const box = new THREE.Box3().setFromObject(map); // 计算包围盒
  const center = box.getCenter(new THREE.Vector3()); // 包围盒中心
  map.position.x -= center.x; // X 方向居中
  map.position.z -= center.z; // Z 方向居中
};

/** 将 GeoJSON 环坐标挤出为 3D 区块 */
const createMesh = (data) => {
  const shape = new THREE.Shape(); // 二维形状

  data.forEach((item, idx) => {
    const [x, y] = offsetXY(item); // 经纬度投影
    if (idx === 0) {
      shape.moveTo(x, -y); // 移动到起点
    } else {
      shape.lineTo(x, -y); // 连线到当前点
      vertices.push(x, -y, mapStyle.deep); // 记录顶点供包围盒计算
    }
  });

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: mapStyle.deep, // 挤出厚度
    bevelEnabled: false, // 关闭倒角
  });

  const topMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(mapStyle.planeColor), // 顶面颜色
    roughness: 0.45, // 粗糙度
    metalness: 0.8, // 金属度
    transparent: true, // 透明
    side: THREE.DoubleSide, // 双面
  });

  const sideMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(mapStyle.sideColor), // 侧面颜色
    roughness: 0.45, // 粗糙度
    metalness: 0.8, // 金属度
    transparent: true, // 透明
    opacity: 0.9, // 侧面透明度
    side: THREE.DoubleSide, // 双面
  });

  return new THREE.Mesh(geometry, [topMaterial, sideMaterial, sideMaterial]); // 顶面 + 两个侧面
};

/** 创建区域顶面与底面边界线 */
const createLine = (data) => {
  const points = []; // 顶点数组

  data.forEach((item) => {
    const [x, y] = offsetXY(item); // 投影坐标
    points.push(new THREE.Vector3(x, -y, 0)); // 底面 z=0 的点
  });

  const lineGeometry = new THREE.BufferGeometry().setFromPoints(points); // 线几何体
  const lineMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(mapStyle.lineColor), // 边界线颜色
  });

  const upLine = new THREE.Line(lineGeometry, lineMaterial); // 顶面线
  const downLine = new THREE.Line(lineGeometry, lineMaterial.clone()); // 底面线
  downLine.position.z = -0.0001; // 底面线微偏移防闪烁
  upLine.position.z = mapStyle.deep + 0.0001; // 顶面线微偏移防闪烁
  return [upLine, downLine]; // 返回顶线、底线
};

/** 创建柱体垂直辉光渐变纹理 */
const createHuiguangTexture = () => {
  const canvas = document.createElement("canvas"); // 画布
  canvas.width = 64; // 宽
  canvas.height = 256; // 高
  const ctx = canvas.getContext("2d"); // 2D 上下文
  const gradient = ctx.createLinearGradient(0, 0, 0, 256); // 垂直渐变
  gradient.addColorStop(0, "rgba(255,255,255,0.75)"); // 顶部最亮
  gradient.addColorStop(0.25, "rgba(232,252,255,0.55)"); // 上段
  gradient.addColorStop(0.5, "rgba(200,245,248,0.3)"); // 中段
  gradient.addColorStop(0.75, "rgba(95,213,225,0.12)"); // 下段
  gradient.addColorStop(1, "rgba(95,213,225,0)"); // 底部透明
  ctx.fillStyle = gradient; // 填充样式
  ctx.fillRect(0, 0, 64, 256); // 绘制
  const texture = new THREE.CanvasTexture(canvas); // 转纹理
  texture.colorSpace = THREE.SRGBColorSpace; // sRGB
  return texture;
};

/** 创建柱顶径向辉光纹理 */
const createGlowRadialTexture = () => {
  const size = 128; // 纹理尺寸
  const canvas = document.createElement("canvas"); // 画布
  canvas.width = size; // 宽
  canvas.height = size; // 高
  const ctx = canvas.getContext("2d"); // 2D 上下文
  const gradient = ctx.createRadialGradient(
    size / 2, // 圆心 X
    size / 2, // 圆心 Y
    0, // 内圆半径
    size / 2, // 外圆心 X
    size / 2, // 外圆心 Y
    size / 2, // 外圆半径
  );
  gradient.addColorStop(0, "rgba(255,255,255,0.55)"); // 中心高光
  gradient.addColorStop(0.35, "rgba(95,213,225,0.45)"); // 过渡色
  gradient.addColorStop(1, "rgba(95,213,225,0)"); // 边缘透明
  ctx.fillStyle = gradient; // 填充样式
  ctx.fillRect(0, 0, size, size); // 绘制
  return new THREE.CanvasTexture(canvas); // 返回纹理
};

/** 创建沿 Z 轴向上的柱体几何体 */
const createBarCylinderGeometry = (radius, height, segments = 6) => {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, segments); // 棱柱
  geometry.rotateX(Math.PI / 2); // 旋转为沿 Z 轴
  geometry.translate(0, 0, height / 2); // 底部对齐 Z=0
  return geometry;
};

/** 柱体内部交叉发光平面 */
const createBarLights = (height, color) => {
  const geometry = new THREE.PlaneGeometry(mapStyle.barLightWidth, height); // 细长平面
  geometry.translate(0, height / 2, 0); // 底部对齐

  const material = new THREE.MeshBasicMaterial({
    color, // 发光颜色
    map: mapStyle.huiguangTexture, // 垂直渐变贴图
    transparent: true, // 透明
    opacity: mapStyle.barLightOpacity, // 透明度
    depthWrite: false, // 不写深度
    side: THREE.DoubleSide, // 双面
    blending: THREE.AdditiveBlending, // 叠加混合
  });

  const mesh = new THREE.Mesh(geometry, material); // 第一块发光面
  mesh.renderOrder = 11; // 渲染顺序
  mesh.rotateX(Math.PI / 2); // 竖直放置

  const mesh2 = mesh.clone(); // 克隆第二块
  mesh2.rotateY(Math.PI / 3); // 旋转 60°
  const mesh3 = mesh.clone(); // 克隆第三块
  mesh3.rotateY((Math.PI / 3) * 2); // 旋转 120°

  return [mesh, mesh2, mesh3]; // 三块交叉发光面
};

/** 创建柱底发光光圈（外圈 + 内圈） */
const createBarAperture = (ringStore) => {
  const quanGroup = new THREE.Group(); // 光圈组

  const outerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff, // 白色
    map: mapStyle.guangquan01, // 颜色贴图
    alphaMap: mapStyle.guangquan01, // 透明贴图
    opacity: 1, // 不透明
    transparent: true, // 开启透明
    depthTest: false, // 关闭深度测试
    fog: false, // 不受雾影响
    blending: THREE.AdditiveBlending, // 叠加发光
    side: THREE.DoubleSide, // 双面
  });

  const outerRing = new THREE.Mesh(
    new THREE.PlaneGeometry(
      mapStyle.barRingOuterSize, // 外圈宽
      mapStyle.barRingOuterSize, // 外圈高
    ),
    outerMaterial, // 外圈材质
  );
  outerRing.renderOrder = 8; // 渲染顺序
  outerRing.position.z = 0.002; // 略高于柱底

  const innerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff, // 白色
    alphaMap: mapStyle.guangquan02, // 仅 alpha 贴图镂空
    opacity: 1, // 不透明
    transparent: true, // 开启透明
    depthTest: false, // 关闭深度测试
    fog: false, // 不受雾影响
    blending: THREE.AdditiveBlending, // 叠加发光
    side: THREE.DoubleSide, // 双面
  });

  const innerRing = new THREE.Mesh(
    new THREE.PlaneGeometry(
      mapStyle.barRingInnerSize, // 内圈宽
      mapStyle.barRingInnerSize, // 内圈高
    ),
    innerMaterial, // 内圈材质
  );
  innerRing.renderOrder = 8; // 渲染顺序
  innerRing.position.z = 0.003; // 略高于外圈

  quanGroup.add(outerRing, innerRing); // 加入光圈组
  ringStore.push(outerRing, innerRing); // 加入区县光圈动画集合
  return quanGroup;
};

/** 创建单个区县光柱 */
const createAreaBar = (item, clickTargets, barRings) => {
  const barHeight = getBarHeight(item.value); // 柱体高度
  const barData = {
    event_type: "bar", // 类型：柱图
    event_name: item.name, // 区县名
    properties: { name: item.name, value: item.value }, // 业务数据
  };

  const areaBar = new THREE.Group(); // 光柱组
  areaBar.name = "district_bar"; // 名称标识
  Object.assign(areaBar.userData, barData); // 挂载交互数据

  const outerMaterial = new THREE.MeshStandardMaterial({
    color: mapStyle.barColor, // 主体色 #5fd5e1
    emissive: mapStyle.barEmissive, // 自发光色
    emissiveIntensity: mapStyle.barEmissiveIntensity, // 自发光强度
    transparent: true, // 透明
    opacity: mapStyle.barOpacity, // 透明度
    metalness: 0.3, // 金属度
    roughness: 0.2, // 粗糙度
    side: THREE.DoubleSide, // 双面
    depthWrite: false, // 不写深度
  });

  const outerMesh = new THREE.Mesh(
    createBarCylinderGeometry(mapStyle.barRadius, barHeight, 6), // 外层六棱柱
    outerMaterial, // 外壳材质
  );
  outerMesh.renderOrder = 9; // 渲染顺序
  Object.assign(outerMesh.userData, barData); // 挂载交互数据

  const coreMaterial = new THREE.MeshBasicMaterial({
    color: mapStyle.barGlowColor, // 内芯颜色
    map: mapStyle.huiguangTexture, // 垂直渐变
    transparent: true, // 透明
    opacity: mapStyle.barCoreOpacity, // 透明度
    blending: THREE.AdditiveBlending, // 叠加混合
    depthWrite: false, // 不写深度
  });

  const coreMesh = new THREE.Mesh(
    createBarCylinderGeometry(mapStyle.barCoreRadius, barHeight, 6), // 内层细柱
    coreMaterial, // 内芯材质
  );
  coreMesh.renderOrder = 10; // 渲染顺序

  const topCap = new THREE.Mesh(
    new THREE.CircleGeometry(mapStyle.barRadius * 1.05, 6), // 顶部圆盘
    new THREE.MeshBasicMaterial({
      color: mapStyle.barGlowColor, // 顶盖颜色
      map: mapStyle.glowRadialTexture, // 径向辉光
      transparent: true, // 透明
      opacity: mapStyle.barTopOpacity, // 透明度
      blending: THREE.NormalBlending, // 正常混合
      depthWrite: false, // 不写深度
      side: THREE.DoubleSide, // 双面
    }),
  );
  topCap.rotation.x = 0; // 圆盘水平放置
  topCap.position.z = barHeight + 0.001; // 置于柱顶
  topCap.renderOrder = 12; // 渲染顺序

  const lights = createBarLights(barHeight, mapStyle.barGlowColor); // 交叉发光面
  const aperture = createBarAperture(barRings); // 柱底光圈
  areaBar.add(outerMesh, coreMesh, topCap, aperture, ...lights); // 组装光柱

  const [x, y] = offsetXY(item.centroid); // 质心投影坐标
  areaBar.position.set(x, -y, mapStyle.deep); // 柱底贴在地图顶面

  clickTargets.push(outerMesh); // 外壳参与点击检测
  return areaBar; // 返回光柱组
};

/** 在区县质心创建 Sprite 定位图标 */
const createIcon = (point, meta, clickTargets, sprites) => {
  const material = new THREE.SpriteMaterial({
    color: mapStyle.iconColors[meta.index % mapStyle.iconColors.length], // 交替颜色
    map: mapStyle.pointTexture, // 图标贴图
    transparent: true, // 透明
    fog: false, // 不受雾影响
    depthTest: false, // 关闭深度测试
  });

  const sprite = new THREE.Sprite(material); // 创建精灵
  const size = mapStyle.iconSize; // 图标尺寸
  const [x, y] = offsetXY(point || [0, 0]); // 投影坐标
  const baseZ = mapStyle.deep + mapStyle.iconDepthOffset; // 基准高度
  sprite.scale.set(size, size, size); // 设置缩放
  sprite.position.set(x, -y, baseZ); // 设置位置
  sprite.renderOrder = 13; // 渲染在柱体之上
  sprite.userData.event_type = "sprite"; // 类型：图标
  sprite.userData.event_name = meta.name; // 区县名
  sprite.userData.index = meta.index; // 索引
  sprite.userData.baseZ = baseZ; // 浮动动画基准 Z
  sprite.userData.baseSize = size; // 呼吸动画基准尺寸
  clickTargets.push(sprite); // 加入区县交互集合
  sprites.push(sprite); // 加入区县动画集合
  return sprite;
};

/** 创建柱顶区县信息卡片（CSS3D） */
const createDistrictInfoLabel = ({ name, point, depth, value, index }) => {
  const enName = name.replace(/[区县市]/g, "").toUpperCase(); // 英文展示名
  const badgeNum = (index % 10) + 1; // 徽章数字 1~10
  const badgeColor = index % 2 === 0 ? "#0bc484" : "#1fb8e0"; // 徽章颜色

  const tag = document.createElement("div"); // HTML 容器
  tag.className = "district-info-label"; // CSS 类名
  tag.innerHTML = `
    <div class="info-card">
      <div class="info-left">
        <span class="info-value">${value}</span>
        <span class="info-unit">个电站</span>
      </div>
      <div class="info-center">
        <span class="info-cn">${name}</span>
        <span class="info-en">${enName}</span>
      </div>
      <span class="info-badge" style="background:${badgeColor}">${badgeNum}</span>
    </div>
    <div class="info-line"></div>
  `;
  tag.style.position = "absolute"; // 绝对定位
  tag.style.pointerEvents = "none"; // 不拦截鼠标

  const label = new CSS3DObject(tag); // 包装为 CSS3D 对象
  label.scale.set(0.0035, 0.0035, 0.0035); // 缩放适配场景
  label.rotation.x = Math.PI / 2; // 绕 X 轴旋转 90°
  const [x, y] = offsetXY(point || [0, 0]); // 投影坐标
  label.position.set(x, -y, depth); // 柱顶上方
  return label;
};

/** 根据 mesh 顶点计算地图包围范围 */
const getMeshBounds = () => {
  let minX = Infinity; // 最小 X
  let maxX = -Infinity; // 最大 X
  let minY = Infinity; // 最小 Y（南侧）
  let maxY = -Infinity; // 最大 Y（北侧）

  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i]; // 顶点 X
    const y = vertices[i + 1]; // 顶点 Y
    if (x < minX) minX = x; // 更新最小 X
    if (x > maxX) maxX = x; // 更新最大 X
    if (y < minY) minY = y; // 更新最小 Y
    if (y > maxY) maxY = y; // 更新最大 Y
  }

  return {
    minX, // 最西侧
    maxX, // 最东侧
    minY, // 最南侧
    maxY, // 最北侧
    centerX: (minX + maxX) / 2, // 水平中心
    centerY: (minY + maxY) / 2, // 垂直中心
    width: maxX - minX, // 地图宽度
    height: maxY - minY, // 地图高度
  };
};

/** 根据全部区县包围盒计算市级范围 */
const getCityBounds = () => {
  let minX = Infinity; // 最小 X
  let maxX = -Infinity; // 最大 X
  let minY = Infinity; // 最小 Y
  let maxY = -Infinity; // 最大 Y

  allDistrictEntries.forEach((entry) => {
    const { bounds } = entry; // 区县包围盒
    if (bounds.minX < minX) minX = bounds.minX; // 更新最小 X
    if (bounds.maxX > maxX) maxX = bounds.maxX; // 更新最大 X
    if (bounds.minY < minY) minY = bounds.minY; // 更新最小 Y
    if (bounds.maxY > maxY) maxY = bounds.maxY; // 更新最大 Y
  });

  return {
    minX, // 最西侧
    maxX, // 最东侧
    minY, // 最南侧
    maxY, // 最北侧
    centerX: (minX + maxX) / 2, // 水平中心
    centerY: (minY + maxY) / 2, // 垂直中心
    width: maxX - minX, // 全市宽度
    height: maxY - minY, // 全市高度
  };
};

/** 创建底部 CSS3D 标题（广州市或区县名） */
const createHtml3dLabel = (titleCn = "广州", titleEn = "GUANGZHOU") => {
  const content = `
    <div class="country-cn">${titleCn}</div>
    <div class="country-en">${titleEn}</div>
  `;
  const tag = document.createElement("div"); // HTML 容器
  tag.innerHTML = content; // 注入标题 HTML
  tag.className = "country-label"; // CSS 类名
  tag.style.position = "absolute"; // 绝对定位
  tag.style.pointerEvents = "none"; // 不拦截鼠标

  const bounds = getMeshBounds(); // 地图包围范围
  const label = new CSS3DObject(tag); // CSS3D 对象
  label.scale.set(0.0038, 0.0038, 0.0038); // 缩放
  label.rotation.x = Math.PI / 2; // 绕 X 轴旋转 90°
  label.position.set(
    bounds.centerX, // 水平居中
    bounds.minY - bounds.width * 0.12, // 地图南缘下方
    mapStyle.deep + 0.02, // 贴在地图顶面
  );
  return label;
};

/** 创建地图底部双层旋转光圈（教程 createCirclePlane） */
const createGuangzhouBottomLight = () => {
  if (!mapStyle.rotationBorder1 || !mapStyle.rotationBorder2) {
    return new THREE.Group(); // 贴图未加载时返回空组
  }

  const bounds = getMeshBounds(); // 地图包围范围
  const mapSpan = Math.max(bounds.width, bounds.height, 0.1); // 地图跨度
  const radius1 = mapSpan * 1.4; // 大光圈尺寸（教程 130 等比）
  const radius2 = radius1 * (110 / 130); // 小光圈尺寸（教程 110 等比）

  const group = new THREE.Group(); // 光圈组

  const plane1 = new THREE.PlaneGeometry(radius1, radius1); // 大圈平面几何
  const material1 = new THREE.MeshBasicMaterial({
    map: mapStyle.rotationBorder1, // 颜色贴图 dibuguangquan1
    alphaMap: mapStyle.rotationBorder1, // 透明贴图
    color: mapStyle.bottomCircleColor, // 着色 #2aa8ac
    transparent: true, // 透明
    opacity: mapStyle.bottomCircleOpacity, // 透明度 0.2
    side: THREE.DoubleSide, // 双面
    depthWrite: false, // 不写深度
    blending: THREE.AdditiveBlending, // 叠加发光
  });
  const bigCirclePlane = new THREE.Mesh(plane1, material1); // 大光圈 mesh
  bigCirclePlane.position.set(bounds.centerX, bounds.centerY, -0.01); // 地图底部中心
  bigCirclePlane.renderOrder = 2; // 渲染顺序

  const plane2 = new THREE.PlaneGeometry(radius2, radius2); // 小圈平面几何
  const material2 = new THREE.MeshBasicMaterial({
    map: mapStyle.rotationBorder2, // 颜色贴图 dibuguangquan2
    alphaMap: mapStyle.rotationBorder2, // 透明贴图
    color: mapStyle.bottomCircleColor, // 着色 #2aa8ac
    transparent: true, // 透明
    opacity: mapStyle.bottomCircleOpacity, // 透明度 0.2
    side: THREE.DoubleSide, // 双面
    depthWrite: false, // 不写深度
    blending: THREE.AdditiveBlending, // 叠加发光
  });
  const smallCirclePlane = new THREE.Mesh(plane2, material2); // 小光圈 mesh
  smallCirclePlane.position.set(bounds.centerX, bounds.centerY, -0.01); // 与大圈同位置
  smallCirclePlane.renderOrder = 2; // 渲染顺序

  group.add(bigCirclePlane, smallCirclePlane); // 加入光圈组
  return group; // 返回光圈组（动画集合由 refreshActiveCollections 维护）
};
</script>

<style lang="scss" scoped>
/* scoped：样式仅作用于当前组件 */
#map {
  width: 100vw; /* 容器宽度占满视口 */
  height: 100vh; /* 容器高度占满视口 */
  position: relative; /* 子元素绝对定位参考 */
  overflow: hidden; /* 隐藏溢出 */
  background-color: #010826; /* 深蓝背景色 */
}

.back-btn {
  position: absolute; /* 浮在地图左上角 */
  top: 20px;
  left: 20px;
  z-index: 10; /* 高于 canvas 层 */
  padding: 8px 18px;
  border: 1px solid rgba(95, 213, 225, 0.55);
  border-radius: 20px;
  background: rgba(16, 24, 38, 0.88);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s ease;

  &:hover {
    background: rgba(42, 168, 172, 0.35); /* 悬停高亮 */
  }
}

/* :deep 穿透 scoped，作用于动态创建的 CSS3D DOM */
:deep(.country-label) {
  padding: 12px 48px 16px; /* 内边距 */
  text-align: center; /* 文字居中 */
  pointer-events: none; /* 不拦截鼠标 */
}

:deep(.country-label .country-cn) {
  color: #fff; /* 中文白色 */
  font-size: 42px; /* 字号 */
  font-weight: 500; /* 字重 */
  line-height: 2; /* 行高 */
  text-align: center; /* 居中 */
  letter-spacing: 4px; /* 字间距 */
}

:deep(.country-label .country-en) {
  color: #a6d4ee; /* 英文浅蓝 */
  font-size: 24px; /* 字号 */
  font-weight: 400; /* 字重 */
  text-align: center; /* 居中 */
  position: relative; /* 相对定位 */
  top: -4px; /* 上移缩小间距 */
  letter-spacing: 3px; /* 字间距 */
}

/* 柱顶区县信息卡片样式 */
:deep(.district-info-label) {
  pointer-events: none; /* 不拦截鼠标 */
}

:deep(.district-info-label .info-card) {
  display: flex; /* 横向布局 */
  align-items: center; /* 垂直居中 */
  gap: 14px; /* 子元素间距 */
  padding: 10px 18px 10px 14px; /* 内边距 */
  background: rgba(16, 24, 38, 0.88); /* 深色半透明底 */
  border: 1px solid rgba(95, 213, 225, 0.35); /* 青色描边 */
  border-radius: 28px; /* 圆角 */
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35); /* 阴影 */
  white-space: nowrap; /* 不换行 */
}

:deep(.district-info-label .info-left) {
  display: flex; /* 横向布局 */
  align-items: baseline; /* 基线对齐 */
  gap: 4px; /* 间距 */
}

:deep(.district-info-label .info-value) {
  color: #fff; /* 数值白色 */
  font-size: 28px; /* 大号字 */
  font-weight: 700; /* 加粗 */
  line-height: 1; /* 行高 */
}

:deep(.district-info-label .info-unit) {
  color: rgba(255, 255, 255, 0.75); /* 单位半透明白 */
  font-size: 12px; /* 小字号 */
}

:deep(.district-info-label .info-center) {
  display: flex; /* 纵向布局容器 */
  flex-direction: column; /* 纵向排列 */
  align-items: flex-start; /* 左对齐 */
  line-height: 1.2; /* 行高 */
}

:deep(.district-info-label .info-cn) {
  color: #fff; /* 中文白色 */
  font-size: 16px; /* 字号 */
  font-weight: 600; /* 半粗 */
}

:deep(.district-info-label .info-en) {
  color: #8ecae6; /* 英文浅蓝 */
  font-size: 11px; /* 小字号 */
  letter-spacing: 1px; /* 字间距 */
}

:deep(.district-info-label .info-badge) {
  min-width: 28px; /* 最小宽度 */
  height: 28px; /* 高度 */
  padding: 0 8px; /* 左右内边距 */
  border-radius: 14px; /* 圆角胶囊 */
  color: #fff; /* 数字白色 */
  font-size: 14px; /* 字号 */
  font-weight: 700; /* 加粗 */
  display: flex; /* flex 居中 */
  align-items: center; /* 垂直居中 */
  justify-content: center; /* 水平居中 */
}

:deep(.district-info-label .info-line) {
  width: 2px; /* 连接线宽度 */
  height: 18px; /* 连接线高度 */
  margin: 0 auto; /* 水平居中 */
  background: linear-gradient(
    to bottom,
    rgba(95, 213, 225, 0.9),
    rgba(95, 213, 225, 0)
  ); /* 自上而下渐隐 */
}
</style>
