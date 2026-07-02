<!-- @format -->

<template>
  <!-- Three.js 渲染容器，canvas 会挂载到这个 div 里 -->
  <div id="map"></div>
</template>
<script setup>
import { onMounted } from "vue";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as d3 from "d3";
// Vite 会将 .json 直接解析为 JS 对象，无需 JSON.parse
import guangzhouGeojson from "@/utils/guangzhou.json";
import { normalizeTiandituData } from "@/utils/tiandituAdapter.js";

onMounted(() => {
  // ============ 1. 初始化基础组件 ============

  // 场景：所有 3D 对象（地图、灯光等）的容器
  const scene = new THREE.Scene();

  // 透视相机：模拟人眼近大远小的视觉效果
  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    10000,
  );

  // ============ 2. 灯光 ============
  // MeshStandardMaterial 受光照影响，没有灯光会呈现黑色
  // 环境光：均匀照亮所有面，颜色与页面背景一致
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(80, 120, 60);
  scene.add(dirLight);
  const fillLight = new THREE.DirectionalLight(0xd4e7fd, 0.3);
  fillLight.position.set(-60, 40, -80);
  scene.add(fillLight);

  // ============ 3. 渲染器 ============
  // WebGL 渲染器：负责把 scene + camera 画到 canvas 上
  // alpha: true 表示 canvas 背景透明，显示 CSS 背景色
  const renderer = new THREE.WebGLRenderer({ alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById("map").appendChild(renderer.domElement);

   // 轨道控制器：鼠标拖拽旋转/缩放视角
   const controls = new OrbitControls(camera, renderer.domElement);
  controls.update();

  // ============ 4. 渲染循环 ============
  // requestAnimationFrame 每帧调用一次，持续刷新画面
  const animate = () => {
    requestAnimationFrame(animate);
    controls.update(); // 若接入 OrbitControls，需在此更新
    renderer.render(scene, camera);
    // labelRenderer.render(scene, camera); // CSS2D 标签渲染器（可选）
  };
  animate();

  // ============ 5. 响应式 ============
  // 窗口缩放时同步更新相机宽高比和 canvas 尺寸，避免变形
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix(); // 修改 aspect 后必须调用
    renderer.setSize(window.innerWidth, window.innerHeight);
    // labelRenderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ============ 6. 加载 GeoJSON 并构建地图 ============
  // 天地图下载 GeoJSON / API 数据均先 normalize 再渲染
  const map = createMap(normalizeTiandituData(guangzhouGeojson));
  scene.add(map);

  // 必须根据地图实际尺寸拉远相机，固定 (0,8,8) 会导致地图占满屏幕
  const box = new THREE.Box3().setFromObject(map);
  const mapCenter = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.z, 1);
  const fovRad = (camera.fov * Math.PI) / 180;
  const padding = 1.2;
  const distanceV = (maxDim / 2 / Math.tan(fovRad / 2)) * padding;
  const distanceH =
    (maxDim / 2 / (Math.tan(fovRad / 2) * camera.aspect)) * padding;
  const distance = Math.max(distanceV, distanceH);
  camera.position.set(
    mapCenter.x,
    mapCenter.y + distance,
    mapCenter.z + distance * 0.05,
  );
  camera.lookAt(mapCenter);
  controls.target.copy(mapCenter);
  controls.minDistance = distance * 0.4;
  controls.maxDistance = distance * 3;
  controls.update();
});

// ============ D3 墨卡托投影 ============
// geoMercator 将 [经度, 纬度] 转为平面像素坐标，供 Three.js 绘制
const offsetXY = d3.geoMercator();
// 投影中心偏移量，用于手动平移地图（当前为 [0,0]，即投影中心对齐 Three.js 原点）
let mapOffset = [0, 0];
// 地图投影尺寸，用于计算合理的挤出高度
let mapScale = 200;

/** 蓝紫色系随机色：色相固定 233，饱和度和亮度随机 */
const getRegionColor = () => {
  const color = new THREE.Color();
  color.setHSL(
    233 / 360,
    Math.random() * 0.3 + 0.55,
    Math.random() * 0.3 + 0.55,
  );
  return color;
};

/**
 * 根据 GeoJSON 创建 3D 地图组（按区县 feature 分色）
 * guangzhou.json：11 个区县 feature，properties 仅有 name/gb，无 center
 */
const createMap = (data) => {
  const map = new THREE.Object3D();
  const fitW = window.innerWidth * 0.28;
  const fitH = window.innerHeight * 0.28;
  offsetXY.fitSize([fitW, fitH], data);
  // fitSize 后地理中心落在 (fitW/2, fitH/2)，减此值对齐 Three.js 原点
  mapOffset = [fitW / 2, fitH / 2];
  mapScale = Math.min(fitW, fitH);

  data.features.forEach((feature, featureIndex) => {
    const unit = new THREE.Object3D();
    unit.name = feature.properties?.name ?? `region-${featureIndex}`;
    const { coordinates, type } = feature.geometry;
    const color = getRegionColor();
    // 挤出高度随地图尺寸等比缩放，各区略作差异
    const depth = mapScale * 0.04 + (featureIndex % 5) * (mapScale * 0.004);

    coordinates.forEach((coordinate) => {
      if (type === "MultiPolygon") {
        coordinate.forEach((item) => fn(item));
      } else if (type === "Polygon") {
        fn(coordinate);
      }

      function fn(ring) {
        const mesh = createMesh(ring, color, depth);
        const line = createLine(ring, depth);
        line.forEach((l) => mesh.add(l));
        unit.add(mesh);
      }
    });
    map.add(unit);
  });
  return map;
};

/**
 * 将 ring 挤出为 3D 区块（ExtrudeGeometry + 旋转到 XZ 地面）
 */
const createMesh = (data, color, depth) => {
  if (!data?.length) return null;

  const shape = new THREE.Shape();
  let hasPoint = false;
  data.forEach((item, idx) => {
    const projected = offsetXY(item);
    if (!projected) return;
    hasPoint = true;
    const [x, y] = projected;
    const px = x - mapOffset[0];
    const py = y - mapOffset[1];
    if (idx === 0) shape.moveTo(px, -py);
    else shape.lineTo(px, -py);
  });
  if (!hasPoint) return null;

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.05,
    bevelSize: depth * 0.03,
    bevelSegments: 2,
  });

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.45,
    metalness: 0.15,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  // 默认沿 Z 挤出，绕 X 轴 -90° 后高度变为 Y 轴（地图"立起来"）
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
};

const createLine = (data, depth) => {
  const points = [];
  data.forEach((item) => {
    const [x, y] = offsetXY(item);
    const px = x - mapOffset[0];
    const py = y - mapOffset[1];
    points.push(new THREE.Vector3(px, -py, 0));
  });
  const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
  const uplineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
  const downlineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });

  const upLine = new THREE.Line(lineGeometry, uplineMaterial);
  const downLine = new THREE.Line(lineGeometry, downlineMaterial);
  downLine.position.z =  depth * 0.004;
  upLine.position.z = depth + depth * 0.06;
  return [upLine, downLine];
};

</script>

<style scoped>
/* 全屏容器，背景色与场景环境光颜色一致 */
#map {
  width: 100vw;
  height: 100vh;
  background-color: #d4e7fd;
}
</style>
