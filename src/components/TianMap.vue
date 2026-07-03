<!-- @format -->

<template>
  <!-- Three.js 渲染容器，WebGL 画布与 CSS2D 标签层均挂载于此 -->
  <div id="map"></div>
</template>

<script setup>
import { onMounted } from "vue";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as d3 from "d3";
import {
  CSS2DRenderer,
  CSS2DObject,
} from "three/examples/jsm/renderers/CSS2DRenderer.js";
// Vite 会将 .json 直接解析为 JS 对象，无需 JSON.parse
import guangzhouGeojson from "@/utils/guangzhou.json";

onMounted(() => {
  // ============ 1. 场景 ============
  const scene = new THREE.Scene();

  // ============ 2. 灯光 ============
  // MeshStandardMaterial 受光照影响，没有灯光会呈现黑色
  const ambientLight = new THREE.AmbientLight(0xd4e7fd, 4);
  scene.add(ambientLight);

  // 四个方向平行光，从上下左右均匀照射，增强立体感
  const directionalLight = new THREE.DirectionalLight(0xe8eaeb, 0.2);
  directionalLight.position.set(0, 10, 5);
  const directionalLight2 = directionalLight.clone();
  directionalLight2.position.set(0, 10, -5);
  const directionalLight3 = directionalLight.clone();
  directionalLight3.position.set(5, 10, 0);
  const directionalLight4 = directionalLight.clone();
  directionalLight4.position.set(-5, 10, 0);
  scene.add(directionalLight, directionalLight2, directionalLight3, directionalLight4);

  // ============ 3. 相机 ============
  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    10000,
  );
  // 初始视角：从右上方斜视原点（地图经 setCenter 平移后位于原点附近）
  camera.position.y = 5;
  camera.position.z = 5;

  // ============ 4. CSS2D 标签渲染器 ============
  // 在 WebGL 画布上方叠加 HTML 文字，与 3D 场景同步投影
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.top = "0px";
  labelRenderer.domElement.style.pointerEvents = "none"; // 不拦截鼠标，便于 OrbitControls 操作
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById("map").appendChild(labelRenderer.domElement);

  // ============ 5. WebGL 渲染器 ============
  const renderer = new THREE.WebGLRenderer({ alpha: true });
  // r155+ 默认 ACES 色调映射会压暗颜色，关闭后与 AliYunMap 参考效果一致
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById("map").appendChild(renderer.domElement);

  // 轨道控制器：鼠标拖拽旋转 / 滚轮缩放视角
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.update();

  // ============ 6. 渲染循环 ============
  const animate = () => {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera); // 每帧同步渲染 HTML 标签
  };
  animate();

  // ============ 7. 响应式 ============
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ============ 8. 构建并添加地图 ============
  const map = createMap(guangzhouGeojson);
  scene.add(map);

  // ============ 9. 点击交互：射线检测高亮选中区域 ============
  let intersect = null; // 当前选中的区县容器（unit）
  window.addEventListener("pointerdown", (event) => {
    // 屏幕坐标 → 标准化设备坐标 NDC，范围 [-1, 1]
    const mouse = new THREE.Vector2();
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    // recursive: true 才能检测到 unit 内部的 Mesh；过滤 Line 避免误选边界线
    const intersects = raycaster
      .intersectObjects(map.children, true)
      .filter((item) => item.object.type !== "Line");

    if (intersects.length > 0) {
      if (intersects[0].object.type === "Mesh") {
        // 恢复上一个选中区域，再高亮当前区域
        if (intersect) setUnitOpacity(intersect, 1);
        intersect = intersects[0].object.parent;
        setUnitOpacity(intersect, 0.4);
      }
      if (intersects[0].object.type === "Sprite") {
        console.log(intersects[0].object);
      }
    } else {
      // 点击空白处取消高亮
      if (intersect) setUnitOpacity(intersect, 1);
    }

    /** 修改区县容器下所有 Mesh 的透明度（需材质 transparent: true） */
    function setUnitOpacity(unit, opacity) {
      unit.children.forEach((item) => {
        if (item.type === "Mesh") {
          item.material.opacity = opacity;
        }
      });
    }
  });
});

// ============ D3 墨卡托投影 ============
// 将 GeoJSON 经纬度 [lng, lat] 转为 Three.js 可用的平面坐标
const offsetXY = d3.geoMercator();

/**
 * 根据 GeoJSON 创建 3D 地图组
 * 每个 feature 对应一个区县，包含挤出网格、边界线、文字标签和图标
 */
const createMap = (data) => {
  const map = new THREE.Object3D();

  // 以第一个区县质心为投影中心，使地图坐标以广州市为中心展开
  const center = data.features[0].properties.centroid;
  offsetXY.center(center).translate([0, 0]);

  data.features.forEach((feature) => {
    // unit：单个区县容器，内含 mesh、边界线等子对象
    const unit = new THREE.Object3D();
    const { centroid, name } = feature.properties;
    const { coordinates, type } = feature.geometry;
    const point = centroid || [0, 0];

    // 随机 HSL 色相固定为 233（蓝紫色系），饱和度和亮度随机
    const color = new THREE.Color(`hsl(
      ${233},
      ${Math.random() * 30 + 55}%,
      ${Math.random() * 30 + 55}%)`).getHex();
    const depth = Math.random() * 0.3 + 0.3; // 挤出高度随机，形成高低起伏

    const label = createLabel(name, point, depth);
    const icon = createIcon(centroid, depth);

    coordinates.forEach((coordinate) => {
      // MultiPolygon：多个独立多边形；Polygon：单个多边形（外环 + 可选内环）
      if (type === "MultiPolygon") coordinate.forEach((item) => fn(item));
      if (type === "Polygon") fn(coordinate);

      function fn(ring) {
        unit.name = name;
        const mesh = createMesh(ring, color, depth);
        const line = createLine(ring, depth);
        unit.add(mesh, ...line);
      }
    });

    map.add(unit, label, icon);
    setCenter(map);
  });

  return map;
};

/**
 * 将 GeoJSON 环坐标挤出为 3D 区块
 * @param {Array} data - 单个 polygon 环，形如 [[lng, lat], ...]
 * @param {number} color - 顶面十六进制颜色
 * @param {number} depth - 挤出深度（厚度）
 */
const createMesh = (data, color, depth) => {
  const shape = new THREE.Shape();

  data.forEach((item, idx) => {
    const [x, y] = offsetXY(item);
    // y 取负：D3 坐标系 Y 轴向下，Three.js Y 轴向上，需翻转
    if (idx === 0) shape.moveTo(x, -y);
    else shape.lineTo(x, -y);
  });

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false, // 关闭倒角，保持区块边缘利落
  });
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: 0x000000,
    roughness: 0.45,
    metalness: 0.8,
    transparent: true, // 配合点击高亮时的 opacity 变化
    side: THREE.DoubleSide,
  });

  return new THREE.Mesh(geometry, material);
};

/**
 * 创建区域顶面与底面的白色边界线
 * 通过微小 z 偏移避免与 Mesh 面片 Z-fighting 闪烁
 */
const createLine = (data, depth) => {
  const points = [];
  data.forEach((item) => {
    const [x, y] = offsetXY(item);
    points.push(new THREE.Vector3(x, -y, 0));
  });
  const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });

  const upLine = new THREE.Line(lineGeometry, lineMaterial);
  const downLine = new THREE.Line(lineGeometry, lineMaterial.clone());
  downLine.position.z = -0.0001;
  upLine.position.z = depth + 0.0001;
  return [upLine, downLine];
};

/** 创建 CSS2D 文字标签，显示区县名称 */
const createLabel = (name, point, depth) => {
  const div = document.createElement("div");
  div.style.color = "#fff";
  div.style.fontSize = "12px";
  div.style.textShadow = "1px 1px 2px #047cd6";
  div.textContent = name;

  const label = new CSS2DObject(div);
  label.scale.set(0.01, 0.01, 0.01);
  const [x, y] = offsetXY(point);
  label.position.set(x, -y, depth);
  return label;
};

/** 在区县质心上方创建 Sprite 定位图标 */
const createIcon = (point, depth) => {
  const url = new URL("../assets/icon.png", import.meta.url).href;
  const texture = new THREE.TextureLoader().load(url);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
  });

  const sprite = new THREE.Sprite(material);
  const [x, y] = offsetXY(point);
  sprite.scale.set(0.3, 0.3, 0.3);
  sprite.position.set(x, -y, depth + 0.2);
  sprite.renderOrder = 1; // 保证图标绘制在 mesh 之上

  return sprite;
};

/**
 * 将地图组旋转到 XZ 地面，并平移使几何中心对齐场景原点
 * ExtrudeGeometry 默认在 XY 平面沿 Z 挤出，绕 X 轴 -90° 后变为平铺在地面
 */
const setCenter = (map) => {
  map.rotation.x = -Math.PI / 2;

  const box = new THREE.Box3().setFromObject(map);
  const center = box.getCenter(new THREE.Vector3());
  map.position.x -= center.x;
  map.position.z -= center.z;
};
</script>

<style scoped>
/* 全屏容器，背景色与场景环境光颜色一致 */
#map {
  background-color: #d4e7fd;
}
</style>
