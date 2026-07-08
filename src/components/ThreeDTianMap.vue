<!-- @format -->

<template>
  <!-- 基于天地图做的 3D 地图 + 柱状图 -->
  <div id="map"></div>
  <!-- Three.js 渲染容器，WebGL / CSS3D / CSS2D 层均挂载于此 -->
</template>

<script setup>
import { onMounted } from "vue"; // Vue 组合式 API：组件挂载后执行初始化
import * as THREE from "three"; // Three.js 核心库，用于 3D 场景渲染
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"; // 轨道控制器：拖拽旋转/缩放
import {
  CSS3DRenderer, // CSS3D 渲染器：用于柱状图等 3D HTML 元素
  CSS3DObject,
} from "three/examples/jsm/renderers/CSS3DRenderer.js";
import {
  CSS2DRenderer, // CSS2D 渲染器：区县名称等始终朝向相机的标签
  CSS2DObject, // CSS2D 对象：将 DOM 元素绑定到 3D 坐标
} from "three/examples/jsm/renderers/CSS2DRenderer.js";
import * as d3 from "d3"; // D3.js：地理投影，将经纬度转为平面坐标
import guangzhouGeojson from "@/utils/guangzhou.json"; // 广州市 GeoJSON 本地数据（Vite 自动解析为对象）

const mapStyle = {
  // 地图全局样式配置
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
  barCoreRadius: 0.006, // 柱体中心光柱半径（更细更柔和）
  barOpacity: 0.52, // 柱体主体透明度
  barCoreOpacity: 0.55, // 内层光柱基础透明度（配合渐变纹理）
  barEmissiveIntensity: 0.35, // 柱体自发光强度
  barLightWidth: 0.045, // 柱体内部交叉发光平面宽度
  barLightOpacity: 0.28, // 交叉发光平面透明度
  barTopOpacity: 0.55, // 柱顶辉光透明度
  labelBarGap: 0.08, // 标签与柱顶间距
  barRingOuterSize: 0.24, // 柱底外圈光圈尺寸
  barRingInnerSize: 0.2, // 柱底内圈光圈尺寸
  huiguangTexture: null, // 垂直辉光渐变纹理
  glowRadialTexture: null, // 顶部径向辉光纹理
  guangquan01: null, // 柱底外圈贴图
  guangquan02: null, // 柱底内圈贴图
  rotationBorder1: null, // 地图底部大光圈（dibuguangquan1.webp）
  rotationBorder2: null, // 地图底部小光圈（dibuguangquan2.webp）
  bottomCircleColor: 0x2aa8ac, // 底部光圈颜色
  bottomCircleOpacity: 0.2, // 底部光圈透明度
  pointTexture: null, // 定位图标贴图
  iconBaseMaterial: null, // 图标共享基础材质
  iconSize: 0.15, // 图标缩放尺寸
  iconColors: [0x5fd5e1, 0xffffff], // 图标交替颜色
  iconDepthOffset: 0.02, // 图标相对地图顶面的高度偏移
};
const offsetXY = d3.geoMercator(); // 创建墨卡托投影实例，用于经纬度 → 平面坐标
const vertices = []; // 存储挤出区块顶点坐标，用于动态创建几何体
let clickMesh = []; // 待点击/悬停的物体集合（勿用 ref，避免 Three.js 对象被 Vue 代理）
let barCircles = []; // 需转动的柱底光圈集合（勿用 ref）
let mapBottomCircles = []; // 需转动的地图底部光圈集合（勿用 ref）
let animatedPoints = []; // 需动画的点集合（勿用 ref）
/** 根据数据值计算柱体高度 */
const getBarHeight = (value) => value * 0.015 + 0.15;

onMounted(() => {
  initScene(); // 异步初始化（需等待底部光圈贴图加载）
});

/** 加载 webp 贴图并遮盖右下角水印区域 */
const loadCleanWebpTexture = (url) =>
  new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const width = image.width;
      const height = image.height;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, width, height);
      // 遮盖右下角「掘金技术社区」水印
      ctx.fillStyle = "#000000";
      ctx.fillRect(
        Math.floor(width * 0.55),
        Math.floor(height * 0.88),
        Math.floor(width * 0.45),
        Math.floor(height * 0.12),
      );
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      resolve(texture);
    };
    image.onerror = () => {
      console.warn("底部光圈贴图加载失败:", url);
      resolve(null);
    };
    image.src = url;
  });

/** 初始化 Three.js 场景、渲染器、交互与地图 */
const initScene = async () => {
  const scene = new THREE.Scene(); // 创建场景，作为所有 3D 对象的根容器

  // ============ 灯光 ============
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
  scene.add(
    // 四向平行光加入场景，增强立体感
    directionalLight,
    directionalLight2,
    directionalLight3,
    directionalLight4,
  );

  // ============ 相机 ============
  const camera = new THREE.PerspectiveCamera(
    55, // 视野角度 FOV（度）
    window.innerWidth / window.innerHeight, // 宽高比，与窗口一致
    0.1, // 近裁剪面：距离相机多近开始渲染
    10000, // 远裁剪面：距离相机多远停止渲染
  );
  camera.position.y = 4; // 相机 Y 坐标：从上方俯视
  camera.position.z = 4; // 相机 Z 坐标：从斜前方观察地图

  // ============ WebGL 渲染器 ============
  const renderer = new THREE.WebGLRenderer({
    alpha: true, // 开启透明背景，露出容器底色
    antialias: true, // 开启抗锯齿，边缘更平滑
  });
  renderer.toneMapping = THREE.NoToneMapping; // 关闭色调映射，避免 r155+ 默认 ACES 压暗颜色
  renderer.setPixelRatio(window.devicePixelRatio); // 适配高分屏像素比
  renderer.setSize(window.innerWidth, window.innerHeight); // canvas 尺寸与窗口一致
  renderer.domElement.style.position = "absolute"; // 画布绝对定位，与 CSS3D 层重叠
  renderer.domElement.style.top = "0"; // 画布顶部对齐容器
  renderer.domElement.style.left = "0"; // 画布左侧对齐容器
  renderer.domElement.style.zIndex = "1"; // WebGL 底层
  document.getElementById("map").appendChild(renderer.domElement); // 将 WebGL canvas 挂到 #map

  // ============ CSS3D 渲染器（柱状图等） ============
  const css3DRenderer = new CSS3DRenderer(); // 创建 CSS3D 渲染器，供后续柱状图使用
  css3DRenderer.setSize(window.innerWidth, window.innerHeight); // 层尺寸与窗口一致
  css3DRenderer.domElement.style.position = "absolute"; // 绝对定位，覆盖在 canvas 上
  css3DRenderer.domElement.style.top = "0"; // 顶部对齐容器
  css3DRenderer.domElement.style.left = "0"; // 左侧对齐容器
  css3DRenderer.domElement.style.pointerEvents = "none"; // 不拦截鼠标，便于 OrbitControls 操作
  css3DRenderer.domElement.style.zIndex = "2"; // CSS3D 层在 WebGL 之上
  document.getElementById("map").appendChild(css3DRenderer.domElement); // 挂到 #map

  // ============ CSS2D 标签渲染器（区县名称） ============
  const labelRenderer = new CSS2DRenderer(); // 创建 HTML 标签专用渲染器
  labelRenderer.setSize(window.innerWidth, window.innerHeight); // 标签层尺寸与窗口一致
  labelRenderer.domElement.style.position = "absolute"; // 标签层绝对定位，覆盖在 canvas 上
  labelRenderer.domElement.style.top = "0"; // 标签层顶部对齐容器
  labelRenderer.domElement.style.left = "0"; // 标签层左侧对齐容器
  labelRenderer.domElement.style.pointerEvents = "none"; // 标签不拦截鼠标，便于 OrbitControls 操作
  labelRenderer.domElement.style.zIndex = "3"; // CSS2D 最上层
  document.getElementById("map").appendChild(labelRenderer.domElement); // 将标签层 DOM 挂到 #map

  // ============ 轨道控制器 ============
  const controls = new OrbitControls(camera, renderer.domElement); // 轨道控制器，绑定相机与 canvas
  controls.update(); // 初始化控制器内部状态

  // ============ 渲染循环 ============
  const animate = () => {
    // 定义每帧执行的动画函数
    requestAnimationFrame(animate); // 浏览器下一帧再次调用 animate，形成循环
    controls.update(); // 更新控制器（阻尼、自动旋转等）
    barCircles.forEach((ring, index) => {
      ring.rotation.z += index % 2 === 0 ? 0.02 : -0.015;
    });
    mapBottomCircles.forEach((ring, index) => {
      ring.rotation.z += index % 2 === 0 ? 0.003 : -0.008;
    });
    const time = performance.now() * 0.002; // 动画时间因子
    animatedPoints.forEach((sprite, index) => {
      // 图标上下浮动 + 轻微缩放呼吸
      sprite.position.z = sprite.userData.baseZ + Math.sin(time + index) * 0.03;
      const scale =
        sprite.userData.baseSize * (1 + Math.sin(time * 1.5 + index) * 0.08);
      sprite.scale.set(scale, scale, scale);
    });
    renderer.render(scene, camera); // WebGL 渲染 3D 场景
    css3DRenderer.render(scene, camera); // CSS3D 同步渲染（柱状图等）
    labelRenderer.render(scene, camera); // CSS2D 同步渲染区县名称标签
  };
  animate(); // 启动渲染循环

  // ============ 响应式 ============
  window.addEventListener("resize", () => {
    // 监听窗口尺寸变化
    camera.aspect = window.innerWidth / window.innerHeight; // 更新相机宽高比
    camera.updateProjectionMatrix(); // 宽高比变化后必须更新投影矩阵
    renderer.setSize(window.innerWidth, window.innerHeight); // 同步 WebGL canvas 尺寸
    css3DRenderer.setSize(window.innerWidth, window.innerHeight); // 同步 CSS3D 层尺寸
    labelRenderer.setSize(window.innerWidth, window.innerHeight); // 同步 CSS2D 层尺寸
  });

  // ============ 构建并添加地图 ============
  mapStyle.huiguangTexture = createHuiguangTexture(); // 创建柱体垂直辉光纹理
  mapStyle.glowRadialTexture = createGlowRadialTexture(); // 创建柱顶径向辉光纹理
  const textureLoader = new THREE.TextureLoader(); // 贴图加载器
  mapStyle.guangquan01 = textureLoader.load(
    new URL("../assets/guangquan1.webp", import.meta.url).href,
  ); // 柱底外圈贴图
  mapStyle.guangquan02 = textureLoader.load(
    new URL("../assets/guangquan2.webp", import.meta.url).href,
  ); // 柱底内圈贴图
  mapStyle.rotationBorder1 = await loadCleanWebpTexture(
    new URL("../assets/dibuguangquan1.webp", import.meta.url).href,
  ); // 地图底部大光圈
  mapStyle.rotationBorder2 = await loadCleanWebpTexture(
    new URL("../assets/dibuguangquan2.webp", import.meta.url).href,
  ); // 地图底部小光圈
  mapStyle.pointTexture = textureLoader.load(
    new URL("../assets/icon.png", import.meta.url).href,
  ); // 图标贴图

  clickMesh = []; // 重置可交互物体集合
  barCircles = []; // 重置需转动的光圈集合
  mapBottomCircles = []; // 重置地图底部光圈集合
  animatedPoints = []; // 重置需动画的图标集合
  const map = createMap(guangzhouGeojson, clickMesh); // 根据 GeoJSON 构建 3D 地图组
  scene.add(map); // 将地图加入场景

  // ============ 射线检测交互（悬停 + 点击） ============
  const raycaster = new THREE.Raycaster(); // 射线检测器，用于判断鼠标指向哪个 3D 对象
  const mouse = new THREE.Vector2(); // 二维向量，存储 NDC 标准化设备坐标
  let hoveredUnit = null; // 当前鼠标悬停的区县容器 unit

  /** 点击区县后的回调，接收 mesh 上挂载的 userData */
  const handleRegionClick = (message) => {
    console.log("点击区县:", message.event_name, message); // 打印区县名称与完整自定义数据
  };

  /** 将屏幕坐标转换为 NDC 并更新射线 */
  const updateRaycaster = (event) => {
    const x = event.clientX; // 鼠标在视口中的 X 坐标
    const y = event.clientY; // 鼠标在视口中的 Y 坐标
    mouse.x = (x / window.innerWidth) * 2 - 1; // 屏幕 X → NDC [-1, 1]
    mouse.y = -(y / window.innerHeight) * 2 + 1; // 屏幕 Y → NDC（Y 轴翻转）
    raycaster.setFromCamera(mouse, camera); // 使用当前相机和映射点修改当前射线属性
  };

  /** 修改区县容器下所有 mesh 的顶面/侧面颜色 */
  const setUnitColor = (unit, planeColor, sideColor) => {
    unit.children.forEach((child) => {
      // 遍历区县容器下的子对象
      if (child.type !== "Mesh") return; // 跳过边界线等非网格对象
      const materials = Array.isArray(child.material) // 判断材质是否为多材质数组
        ? child.material // 多材质：顶面 + 两个侧面
        : [child.material]; // 单材质：包装为数组统一处理
      materials[0]?.color.set(planeColor); // 设置顶面颜色
      materials[1]?.color.set(sideColor); // 设置侧面颜色 1
      materials[2]?.color.set(sideColor); // 设置侧面颜色 2
    });
  };

  /** 根据鼠标事件获取当前悬停的区县容器 */
  const getHoveredUnit = (event) => {
    updateRaycaster(event); // 更新射线位置
    const intersects = raycaster.intersectObjects(clickMesh); // 只检测待交互物体集合
    return intersects.length > 0 ? intersects[0].object.userData.unit : null; // 从 userData 取区县容器
  };

  renderer.domElement.addEventListener("pointermove", (event) => {
    // 监听鼠标移动
    const unit = getHoveredUnit(event); // 获取当前悬停的区县
    if (unit === hoveredUnit) return; // 仍是同一区县，无需重复处理

    if (hoveredUnit) {
      // 存在上一个悬停区县
      setUnitColor(hoveredUnit, mapStyle.planeColor, mapStyle.sideColor); // 恢复上一个区县默认颜色
    }

    hoveredUnit = unit; // 更新当前悬停区县

    if (hoveredUnit) {
      // 鼠标悬停在某个区县上
      setUnitColor(
        // 设置高亮颜色
        hoveredUnit,
        mapStyle.hoverPlaneColor,
        mapStyle.hoverSideColor,
      );
      renderer.domElement.style.cursor = "pointer"; // 鼠标变为手型，提示可交互
    } else {
      // 鼠标未悬停在任何区县上
      renderer.domElement.style.cursor = "default"; // 恢复默认鼠标样式
    }
  });

  renderer.domElement.addEventListener("pointerleave", () => {
    // 鼠标移出画布
    if (!hoveredUnit) return; // 无悬停区县，直接返回
    setUnitColor(hoveredUnit, mapStyle.planeColor, mapStyle.sideColor); // 恢复默认颜色
    hoveredUnit = null; // 清空悬停状态
    renderer.domElement.style.cursor = "default"; // 恢复默认鼠标样式
  });

  renderer.domElement.addEventListener("click", (event) => {
    // 监听鼠标点击
    updateRaycaster(event); // 获取鼠标点击位置并更新射线
    const intersects = raycaster.intersectObjects(clickMesh); // 遍历拾取的物体，只检测 clickMesh 集合
    if (intersects && intersects.length > 0) {
      // 射线命中了可交互物体
      const firstObj = intersects[0]; // 取距离相机最近的第一个交点
      const message = firstObj.object.userData; // 读取物体上挂载的自定义属性
      handleRegionClick(message); // 执行点击回调
    }
  });
};

/**
 * 根据 GeoJSON 创建 3D 地图组
 * 每个 feature 对应一个区县，包含挤出网格、边界线、文字标签和图标
 */
const createMap = (data, clickMesh) => {
  // data：GeoJSON；clickMesh：可交互物体集合
  const map = new THREE.Object3D(); // 地图根容器，包含所有区县

  const center = data.features[0].properties.centroid; // 取第一个区县质心作为投影中心
  offsetXY.center(center).translate([0, 0]); // 配置投影：中心点映射到 (0,0)

  data.features.forEach((feature, index) => {
    // 遍历每个区县 feature
    const unit = new THREE.Object3D(); // 单个区县的容器对象
    const { centroid, center, name, gb } = feature.properties; // 解构：质心、名称、行政区划代码
    const { coordinates, type } = feature.geometry; // 解构：坐标数组、几何类型
    const barPoint = centroid || center || [0, 0]; // 柱状图定位点（区县质心）
    const labelPoint = center || centroid || [0, 0]; // 标签定位点
    const value = Math.floor(Math.random() * 60 + 20); // 模拟区县数据值
    const barHeight = getBarHeight(value); // 柱体高度
    const showBar = index % 2 === 0; // 偶数区县显示柱状图，奇数区县显示图标
    let marker = null; // 区县标记物：柱状图或图标
    let districtLabel = null; // 柱顶信息卡片（仅柱状图区县）

    if (showBar) {
      marker = createAreaBar({ name, centroid: barPoint, value }, clickMesh);
      districtLabel = createDistrictInfoLabel({
        name,
        point: labelPoint,
        depth: mapStyle.deep + barHeight + mapStyle.labelBarGap,
        value,
        index,
      });
    } else {
      marker = createIcon(barPoint, { name, index });
      clickMesh.push(marker);
    }

    coordinates.forEach((coordinate) => {
      // 遍历几何坐标（MultiPolygon / Polygon 结构不同）
      if (type === "MultiPolygon") coordinate.forEach((item) => fn(item)); // 多多边形：每个 polygon 单独处理
      if (type === "Polygon") fn(coordinate); // 单 polygon：直接处理外环

      function fn(ring) {
        // ring：单个多边形外环 [[lng,lat], ...]
        unit.name = name; // 设置 unit 名称为区县名，便于调试
        const mesh = createMesh(ring); // 创建挤出 3D 区块
        mesh.userData.event_type = "mesh"; // 自定义属性：物体类型
        mesh.userData.event_name = name; // 自定义属性：区县名称
        mesh.userData.gb = gb; // 自定义属性：行政区划代码
        mesh.userData.centroid = centroid; // 自定义属性：区县质心坐标
        mesh.userData.index = index; // 自定义属性：区县索引
        mesh.userData.unit = unit; // 自定义属性：所属区县容器，便于 hover 变色
        clickMesh.push(mesh); // 将需要响应点击事件的物体加入 clickMesh 集合
        const line = createLine(ring); // 创建顶底边界线
        unit.add(mesh, ...line); // 将 mesh 和两条线加入区县容器
      }
    });
    if (districtLabel) {
      map.add(unit, marker, districtLabel);
    } else if (marker) {
      map.add(unit, marker);
    } else {
      map.add(unit);
    }
    setCenter(map); // 旋转地图到地面并居中（每加一个区县后更新）
  });
  const cityLabel = createHtml3dLabel(); // 教程图底部城市标题：广州 / GUANGZHOU
  map.add(cityLabel); // 加入地图组
  const bottomLight = createGuangzhouBottomLight(); // 教程 createCirclePlane：底部双层光圈
  map.add(bottomLight);
  return map; // 返回完整地图 Object3D
};

/**
 * 将地图组旋转到 XZ 地面，并平移使几何中心对齐场景原点
 * ExtrudeGeometry 默认在 XY 平面沿 Z 挤出，绕 X 轴 -90° 后变为平铺在地面
 */
const setCenter = (map) => {
  // map：整个地图 Object3D
  map.rotation.x = -Math.PI / 2; // 绕 X 轴旋转 -90°，地图从竖直变为水平（XZ 平面）

  const box = new THREE.Box3().setFromObject(map); // 计算地图包围盒
  const center = box.getCenter(new THREE.Vector3()); // 获取包围盒几何中心
  map.position.x -= center.x; // X 方向平移，使中心对齐原点
  map.position.z -= center.z; // Z 方向平移，使中心对齐原点
};

/**
 * 将 GeoJSON 环坐标挤出为 3D 区块
 * @param {Array} data - 单个 polygon 环，形如 [[lng, lat], ...]
 */
const createMesh = (data) => {
  // 根据环坐标创建 ExtrudeGeometry mesh
  const shape = new THREE.Shape(); // Three.js 二维形状，用于挤出

  data.forEach((item, idx) => {
    // 遍历环上每个经纬度点
    const [x, y] = offsetXY(item); // 墨卡托投影：[lng,lat] → [x,y]
    if (idx === 0) {
      // 第一个点
      shape.moveTo(x, -y); // 移动到起点（y 取负翻转坐标系）
    } else {
      // 后续点
      shape.lineTo(x, -y); // 连线到当前位置，闭合轮廓
      vertices.push(x, -y, mapStyle.deep); // 记录顶点坐标，供后续柱状图等功能使用
    }
  });
  const geometry = new THREE.ExtrudeGeometry(shape, {
    // 将二维形状沿 Z 轴挤出为三维几何体
    depth: mapStyle.deep, // 挤出深度（厚度）
    bevelEnabled: false, // 关闭倒角，保持边缘垂直
  });
  const topMaterial = new THREE.MeshStandardMaterial({
    // 顶面材质
    color: new THREE.Color(mapStyle.planeColor), // 顶面颜色
    roughness: 0.45, // 粗糙度，影响反光散射
    metalness: 0.8, // 金属度，影响镜面反射
    transparent: true, // 开启透明，配合 hover 颜色切换
    side: THREE.DoubleSide, // 双面渲染，避免背面不可见
  });
  const sideMaterial = new THREE.MeshStandardMaterial({
    // 侧面材质
    color: new THREE.Color(mapStyle.sideColor), // 侧面颜色
    roughness: 0.45, // 粗糙度
    metalness: 0.8, // 金属度
    transparent: true, // 开启透明
    opacity: 0.9, // 侧面略透明，增强层次感
    side: THREE.DoubleSide, // 双面渲染
  });
  return new THREE.Mesh(geometry, [topMaterial, sideMaterial, sideMaterial]); // 组合几何体与多材质，返回可渲染网格
};

/**
 * 创建区域顶面与底面的边界线
 * 通过微小 z 偏移避免与 Mesh 面片 Z-fighting 闪烁
 */
const createLine = (data) => {
  // 根据环坐标创建顶底边界线
  const points = []; // 存储三维顶点数组
  data.forEach((item) => {
    // 遍历环上每个点
    const [x, y] = offsetXY(item); // 经纬度投影为平面坐标
    points.push(new THREE.Vector3(x, -y, 0)); // 转为 Three.js 三维点（底面 z=0）
  });
  const lineGeometry = new THREE.BufferGeometry().setFromPoints(points); // 由点集创建线几何体
  const lineMaterial = new THREE.LineBasicMaterial({
    // 线条材质
    color: new THREE.Color(mapStyle.lineColor), // 边界线颜色
  });

  const upLine = new THREE.Line(lineGeometry, lineMaterial); // 顶面边界线
  const downLine = new THREE.Line(lineGeometry, lineMaterial.clone()); // 底面边界线（独立材质实例）
  downLine.position.z = -0.0001; // 底面线略低于 z=0，避免与 mesh 共面闪烁
  upLine.position.z = mapStyle.deep + 0.0001; // 顶面线略高于挤出高度，同样防闪烁
  return [upLine, downLine]; // 返回顶线、底线数组
};


/** 创建内层光柱垂直渐变纹理：底部淡，往上渐亮 */
const createHuiguangTexture = () => {
  const canvas = document.createElement("canvas"); // 创建画布绘制渐变
  canvas.width = 64; // 纹理宽度
  canvas.height = 256; // 纹理高度
  const ctx = canvas.getContext("2d"); // 获取 2D 绘图上下文
  const gradient = ctx.createLinearGradient(0, 0, 0, 256); // 自上而下渐变（映射后：底部淡 → 顶部亮）
  gradient.addColorStop(0, "rgba(255,255,255,0.75)"); // 顶部最亮
  gradient.addColorStop(0.25, "rgba(232,252,255,0.55)"); // 上段明亮
  gradient.addColorStop(0.5, "rgba(200,245,248,0.3)"); // 中段渐弱
  gradient.addColorStop(0.75, "rgba(95,213,225,0.12)"); // 下段很淡
  gradient.addColorStop(1, "rgba(95,213,225,0)"); // 底部几乎透明
  ctx.fillStyle = gradient; // 设置填充样式
  ctx.fillRect(0, 0, 64, 256); // 绘制渐变矩形
  const texture = new THREE.CanvasTexture(canvas); // 转为 Three.js 纹理
  texture.colorSpace = THREE.SRGBColorSpace; // 保证颜色正确
  return texture;
};

/** 创建径向辉光纹理，用于柱顶白色高光 */
const createGlowRadialTexture = () => {
  const size = 128; // 纹理尺寸
  const canvas = document.createElement("canvas"); // 创建画布
  canvas.width = size; // 宽度
  canvas.height = size; // 高度
  const ctx = canvas.getContext("2d"); // 绘图上下文
  const gradient = ctx.createRadialGradient(
    // 径向渐变：中心白 → 边缘透明
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(255,255,255,0.55)"); // 中心柔和高光
  gradient.addColorStop(0.35, "rgba(95,213,225,0.45)"); // 过渡为主体色 #5fd5e1
  gradient.addColorStop(1, "rgba(95,213,225,0)"); // 边缘透明
  ctx.fillStyle = gradient; // 填充样式
  ctx.fillRect(0, 0, size, size); // 绘制圆形辉光
  return new THREE.CanvasTexture(canvas); // 转为纹理
};

/** 创建沿 Z 轴向上的柱体几何体（底部贴地） */
const createBarCylinderGeometry = (radius, height, segments = 6) => {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, segments); // 六棱柱
  geometry.rotateX(Math.PI / 2); // 默认沿 Y 轴，旋转为沿 Z 轴
  geometry.translate(0, 0, height / 2); // 底部对齐 Z=0
  return geometry;
};

/** 柱体内部交叉发光平面，形成白色光柱效果 */
const createBarLights = (height, color) => {
  const geometry = new THREE.PlaneGeometry(mapStyle.barLightWidth, height); // 细长发光平面
  geometry.translate(0, height / 2, 0); // 底部对齐柱体底部

  const material = new THREE.MeshBasicMaterial({
    // 发光平面材质
    color, // 柔和青白色
    map: mapStyle.huiguangTexture, // 垂直辉光纹理
    transparent: true, // 透明
    opacity: mapStyle.barLightOpacity, // 低透明度，避免过白
    depthWrite: false, // 不写入深度
    side: THREE.DoubleSide, // 双面
    blending: THREE.AdditiveBlending, // 叠加混合
  });

  const mesh = new THREE.Mesh(geometry, material); // 第一块发光平面
  mesh.renderOrder = 11; // 后渲染
  mesh.rotateX(Math.PI / 2); // 竖直放置

  const mesh2 = mesh.clone(); // 第二块，旋转 60°
  mesh2.rotateY(Math.PI / 3);
  const mesh3 = mesh.clone(); // 第三块，旋转 120°
  mesh3.rotateY((Math.PI / 3) * 2);

  return [mesh, mesh2, mesh3];
};

/** 创建柱底发光光圈（外圈 + 内圈） */
const createBarAperture = () => {
  const quanGroup = new THREE.Group(); // 光圈组

  // 外圈：map + alphaMap 叠加发光
  const outerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: mapStyle.guangquan01,
    alphaMap: mapStyle.guangquan01,
    opacity: 1,
    transparent: true,
    depthTest: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const outerRing = new THREE.Mesh(
    new THREE.PlaneGeometry(
      mapStyle.barRingOuterSize,
      mapStyle.barRingOuterSize,
    ),
    outerMaterial,
  );
  outerRing.renderOrder = 8;
  outerRing.position.z = 0.002; // 略高于柱底，避免闪烁

  // 内圈：仅 alphaMap 镂空发光
  const innerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    alphaMap: mapStyle.guangquan02,
    opacity: 1,
    transparent: true,
    depthTest: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const innerRing = new THREE.Mesh(
    new THREE.PlaneGeometry(
      mapStyle.barRingInnerSize,
      mapStyle.barRingInnerSize,
    ),
    innerMaterial,
  );
  innerRing.renderOrder = 8;
  innerRing.position.z = 0.003;

  quanGroup.add(outerRing, innerRing);
  barCircles.push(outerRing, innerRing); // 保存需转动的光圈，供动画循环旋转
  return quanGroup;
};

/** 创建单个区县光柱（六棱柱外壳 + 白色内芯 + 顶部辉光） */
const createAreaBar = (item, clickMesh) => {
  const barHeight = getBarHeight(item.value); // 根据数据值计算柱体高度
  const barData = {
    // 柱体交互数据
    event_type: "bar",
    event_name: item.name,
    properties: { name: item.name, value: item.value },
  };

  const areaBar = new THREE.Group(); // 光柱组容器
  areaBar.name = "district_bar";
  Object.assign(areaBar.userData, barData);

  // 外层六棱柱：半透明 #5fd5e1
  const outerMaterial = new THREE.MeshStandardMaterial({
    color: mapStyle.barColor, // #5fd5e1
    emissive: mapStyle.barEmissive, // 青色自发光
    emissiveIntensity: mapStyle.barEmissiveIntensity, // 柔和自发光
    transparent: true,
    opacity: mapStyle.barOpacity,
    metalness: 0.3,
    roughness: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const outerMesh = new THREE.Mesh(
    createBarCylinderGeometry(mapStyle.barRadius, barHeight, 6),
    outerMaterial,
  );
  outerMesh.renderOrder = 9;
  Object.assign(outerMesh.userData, barData);

  // 内层光柱核心：底部淡、往上渐亮
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: mapStyle.barGlowColor, // 柔和青白
    map: mapStyle.huiguangTexture, // 垂直渐变纹理
    transparent: true,
    opacity: mapStyle.barCoreOpacity,
    blending: THREE.AdditiveBlending, // 叠加混合，顶部更亮
    depthWrite: false,
  });
  const coreMesh = new THREE.Mesh(
    createBarCylinderGeometry(mapStyle.barCoreRadius, barHeight, 6),
    coreMaterial,
  );
  coreMesh.renderOrder = 10;

  // 顶部辉光圆盘：中心略亮，边缘融入主体色
  const topCap = new THREE.Mesh(
    new THREE.CircleGeometry(mapStyle.barRadius * 1.05, 6),
    new THREE.MeshBasicMaterial({
      color: mapStyle.barGlowColor,
      map: mapStyle.glowRadialTexture,
      transparent: true,
      opacity: mapStyle.barTopOpacity,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  topCap.rotation.x = 0; // Circle 默认在 XY 平面，与 Z 轴垂直即为顶面
  topCap.position.z = barHeight + 0.001; // 置于柱顶
  topCap.renderOrder = 12;

  const lights = createBarLights(barHeight, mapStyle.barGlowColor); // 交叉发光平面
  const aperture = createBarAperture(); // 柱底发光光圈
  areaBar.add(outerMesh, coreMesh, topCap, aperture, ...lights);

  const [x, y] = offsetXY(item.centroid); // 质心投影坐标
  areaBar.position.set(x, -y, mapStyle.deep); // 柱体底部贴在地图顶面

  clickMesh.push(outerMesh); // 外层柱体参与点击检测
  return areaBar;
};

/** 在区县质心创建 Sprite 定位图标 */
const createIcon = (point, meta) => {
  const material = new THREE.SpriteMaterial({
    color: mapStyle.iconColors[meta.index % mapStyle.iconColors.length],
    map: mapStyle.pointTexture,
    transparent: true,
    fog: false,
    depthTest: false,
  });

  const sprite = new THREE.Sprite(material);
  const size = mapStyle.iconSize;
  const [x, y] = offsetXY(point || [0, 0]);
  const baseZ = mapStyle.deep + mapStyle.iconDepthOffset;
  sprite.scale.set(size, size, size);
  sprite.position.set(x, -y, baseZ);
  sprite.renderOrder = 13; // 绘制在柱体之上
  sprite.userData.event_type = "sprite";
  sprite.userData.event_name = meta.name;
  sprite.userData.index = meta.index;
  sprite.userData.baseZ = baseZ; // 记录基准高度，供浮动动画使用
  sprite.userData.baseSize = size; // 记录基准尺寸，供缩放动画使用
  animatedPoints.push(sprite); // 加入动画集合
  return sprite;
};

/** 创建柱顶区县信息卡片（教程效果图：数值 + 区县名 + 徽章） */
const createDistrictInfoLabel = ({ name, point, depth, value, index }) => {
  const enName = name.replace(/[区县市]/g, "").toUpperCase(); // 英文展示名
  const badgeNum = (index % 10) + 1; // 右侧徽章数字
  const badgeColor = index % 2 === 0 ? "#0bc484" : "#1fb8e0"; // 徽章颜色

  const tag = document.createElement("div"); // 创建 HTML 容器
  tag.className = "district-info-label"; // 类名标识
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
  tag.style.position = "absolute"; // 教程同款：absolute 定位
  tag.style.pointerEvents = "none"; // 不拦截鼠标

  const label = new CSS3DObject(tag); // 包装为 CSS3D 对象
  label.scale.set(0.0035, 0.0035, 0.0035); // 缩放适配广州地图比例
  label.rotation.x = Math.PI / 2; // 绕 X 轴旋转 90°，朝向相机可读
  const [x, y] = offsetXY(point || [0, 0]); // 经纬度 → 投影坐标
  label.position.set(x, -y, depth); // 置于柱顶上方
  return label;
};

/** 根据地图 mesh 顶点计算包围范围（排除 CSS3D 标签，避免包围盒失真） */
const getMeshBounds = () => {
  let minX = Infinity; // 最西侧 X
  let maxX = -Infinity; // 最东侧 X
  let minY = Infinity; // 最南侧 Y
  let maxY = -Infinity; // 最北侧 Y
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY,
  };
};

/**
 * 创建底部城市 CSS3D 标题（教程 createWall 同款，对应红框「中国 / CHINA」位置）
 * 此处展示「广州 / GUANGZHOU」，置于地图正下方居中
 */
const createHtml3dLabel = () => {
  const content = `
    <div class="country-cn">广州</div>
    <div class="country-en">GUANGZHOU</div>
  `;
  const tag = document.createElement("div"); // 创建 HTML 容器
  tag.innerHTML = content; // 注入中英文标题
  tag.className = "country-label"; // 教程同款类名
  tag.style.position = "absolute"; // 教程同款：absolute 定位
  tag.style.pointerEvents = "none"; // 不拦截鼠标

  const bounds = getMeshBounds(); // 仅用 mesh 顶点计算，避免 CSS3D 撑大包围盒
  const label = new CSS3DObject(tag); // 包装为 CSS3D 对象
  label.scale.set(0.0038, 0.0038, 0.0038); // 固定缩放，与柱顶卡片 0.0035 同量级
  label.rotation.x = Math.PI / 2; // 教程同款：绕 X 轴旋转 90°
  label.position.set(
    bounds.centerX, // 地图水平中心
    bounds.minY - bounds.width * 0.12, // 地图南缘再向下偏移
    mapStyle.deep + 0.02, // 贴在地图顶面
  );
  return label;
};

/**
 * 创建地图底部双层旋转光圈（教程 createCirclePlane 同款）
 * 使用 dibuguangquan1.webp / dibuguangquan2.webp
 */
const createGuangzhouBottomLight = () => {
  if (!mapStyle.rotationBorder1 || !mapStyle.rotationBorder2) {
    return new THREE.Group(); // 贴图未加载时返回空组，避免 add(undefined)
  }

  const bounds = getMeshBounds();
  const mapSpan = Math.max(bounds.width, bounds.height, 0.1);
  const radius1 = mapSpan * 1.4; // 教程 PlaneGeometry(130, 130) 等比缩放
  const radius2 = radius1 * (110 / 130); // 教程 PlaneGeometry(110, 110)

  const group = new THREE.Group();

  // 创建第一个大圆环
  const plane1 = new THREE.PlaneGeometry(radius1, radius1);
  const material1 = new THREE.MeshBasicMaterial({
    map: mapStyle.rotationBorder1,
    color: mapStyle.bottomCircleColor,
    transparent: true,
    opacity: mapStyle.bottomCircleOpacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const bigCirclePlane = new THREE.Mesh(plane1, material1);
  bigCirclePlane.position.set(bounds.centerX, bounds.centerY, -0.01);
  bigCirclePlane.renderOrder = 2;

  // 创建第二个小圆环
  const plane2 = new THREE.PlaneGeometry(radius2, radius2);
  const material2 = new THREE.MeshBasicMaterial({
    map: mapStyle.rotationBorder2,
    color: mapStyle.bottomCircleColor,
    transparent: true,
    opacity: mapStyle.bottomCircleOpacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const smallCirclePlane = new THREE.Mesh(plane2, material2);
  smallCirclePlane.position.set(bounds.centerX, bounds.centerY, -0.01);
  smallCirclePlane.renderOrder = 2;

  mapBottomCircles.push(bigCirclePlane, smallCirclePlane);
  group.add(bigCirclePlane, smallCirclePlane);
  return group;
};
</script>

<style lang="scss" scoped>
/* scoped：样式仅作用于当前组件 */
#map {
  width: 100vw; /* 容器宽度占满视口 */
  height: 100vh; /* 容器高度占满视口 */
  position: relative; /* 作为绝对定位子元素（canvas）的定位参考 */
  overflow: hidden; /* 隐藏溢出内容 */
  background-color: #010826; /* 页面背景色，与 canvas 透明区域配合显示 */
}

/* :deep 穿透 scoped，使动态创建的 CSS3D DOM 能应用样式（教程图2 同款） */
:deep(.country-label) {
  // border-radius: 30px 30px 30px 0; /* 教程同款：左上/右上/右下圆角，左下直角 */
  padding: 12px 48px 16px; /* 内边距，留出大字空间 */
  // background: rgba(8, 18, 36, 0.78); /* 深蓝半透明底，贴近效果图暗色背景 */
  text-align: center; /* 文字居中 */
  pointer-events: none; /* 不拦截鼠标 */
}

:deep(.country-label .country-cn) {
  color: #fff; /* 中文白色大字 */
  font-size: 42px; /* 适配广州地图比例（教程全国地图用 60px） */
  font-weight: 500; /* 中等字重 */
  line-height: 2; /* 紧凑行高 */
  text-align: center; /* 居中 */
  letter-spacing: 4px; /* 字间距 */
}

:deep(.country-label .country-en) {
  color: #a6d4ee; /* 教程同款浅蓝色 */
  font-size: 24px; /* 适配广州地图比例（教程全国地图用 35px） */
  font-weight: 400; /* 常规字重 */
  text-align: center; /* 居中 */
  position: relative; /* 相对定位 */
  top: -4px; /* 上移，缩小与中文间距 */
  letter-spacing: 3px; /* 英文间距 */
}

/* 柱顶区县信息卡片样式（效果图浮动标签） */
:deep(.district-info-label) {
  pointer-events: none;
}

:deep(.district-info-label .info-card) {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 18px 10px 14px;
  background: rgba(16, 24, 38, 0.88);
  border: 1px solid rgba(95, 213, 225, 0.35);
  border-radius: 28px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  white-space: nowrap;
}

:deep(.district-info-label .info-left) {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

:deep(.district-info-label .info-value) {
  color: #fff;
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
}

:deep(.district-info-label .info-unit) {
  color: rgba(255, 255, 255, 0.75);
  font-size: 12px;
}

:deep(.district-info-label .info-center) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.2;
}

:deep(.district-info-label .info-cn) {
  color: #fff;
  font-size: 16px;
  font-weight: 600;
}

:deep(.district-info-label .info-en) {
  color: #8ecae6;
  font-size: 11px;
  letter-spacing: 1px;
}

:deep(.district-info-label .info-badge) {
  min-width: 28px;
  height: 28px;
  padding: 0 8px;
  border-radius: 14px;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

:deep(.district-info-label .info-line) {
  width: 2px;
  height: 18px;
  margin: 0 auto;
  background: linear-gradient(
    to bottom,
    rgba(95, 213, 225, 0.9),
    rgba(95, 213, 225, 0)
  );
}
</style>
