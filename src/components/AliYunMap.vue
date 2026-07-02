<!-- @format -->

<template>
  <!-- Three.js 渲染容器，WebGL 画布挂载于此 -->
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
onMounted(() => {
  // ============ 1. 初始化基础组件 ============
  // 场景：所有 3D 对象（地图、灯光等）的容器
  const scene = new THREE.Scene();

  // ============ 2. 灯光 ============
  // MeshStandardMaterial 受光照影响，没有灯光会呈现黑色
  // 环境光：与参考图背景 #dcebff 一致，整体偏亮
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
  scene.add(directionalLight);
  scene.add(directionalLight2);
  scene.add(directionalLight3);
  scene.add(directionalLight4);

  // ============ 3. 相机 ============
  // 透视相机：模拟人眼近大远小的视觉效果
  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  // 初始视角：从右上方斜视原点（地图加载后会通过 setCenter 平移到原点附近）
  camera.position.y = 3.5;
  camera.position.z = 3.5;

// ========== 渲染器 ==========
  // CSS2D 渲染器：用于在 3D 场景中叠加 HTML 文字标签
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.top = "0px";
  labelRenderer.domElement.style.pointerEvents = "none"; // 不拦截鼠标，便于 OrbitControls 操作
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById("map").appendChild(labelRenderer.domElement);

  // ============ 4. 渲染器 ============
  // WebGL 渲染器：负责把 scene + camera 画到 canvas 上
  // alpha: true 表示 canvas 背景透明，显示 CSS 背景色
  const renderer = new THREE.WebGLRenderer({ alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById("map").appendChild(renderer.domElement);

  // 轨道控制器：鼠标拖拽旋转/滚轮缩放视角
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.update();

  // ============ 5. 渲染循环 ============
  // requestAnimationFrame 每帧调用一次，持续刷新画面
  const animate = () => {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  };
  animate();

  // ============ 6. 响应式 ============
  // 窗口缩放时同步更新相机宽高比和 canvas 尺寸，避免画面拉伸变形
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix(); // 修改 aspect 后必须调用
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ============ 7. 加载 GeoJSON 并构建地图 ============
  // 阿里云 DataV 广州市边界（440100 = 广州市 adcode，full 含下级区县）
  const url = "https://geo.datav.aliyun.com/areas_v3/bound/440100_full.json";
  fetch(url)
    .then((response) => response.json())
    .then((data) => {
      const map = createMap(data);
      scene.add(map);

      
      // ========== 点击交互：射线检测高亮选中区域 ==========
      let intersect = null; // 当前选中的区域单元（Object3D）
      window.addEventListener("pointerdown", (event) => {
        // 将屏幕坐标转换为标准化设备坐标（NDC），范围 [-1, 1]
        const mouse = new THREE.Vector2();
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);
        // 过滤掉边界线，只检测 Mesh / Sprite
        const intersects = raycaster
          .intersectObjects(map.children)
          .filter((item) => item.object.type !== "Line");
        console.log("🚀 ~ intersects:", intersects)

        if (intersects.length > 0) {
          if (intersects[0].object.type === "Mesh") {
            // 恢复上一个选中区域的透明度，再高亮当前区域
            if (intersect) isAplha(intersect, 1);
            intersect = intersects[0].object.parent;
            isAplha(intersect, 0.4);
          }
          if (intersects[0].object.type === "Sprite") {
            console.log(intersects[0].object);
          }
        } else {
          // 点击空白处取消高亮
          if (intersect) isAplha(intersect, 1);
        }

        // 修改区域下所有 Mesh 材质的透明度
        function isAplha(intersect, opacity) {
          intersect.children.forEach((item) => {
            if (item.type === "Mesh") {
              item.material.opacity = opacity;
            }
          });
        }
      });
    })
    .catch((error) => console.error("Error fetching map data:", error));
});

// ============ D3 墨卡托投影 ============
const offsetXY = d3.geoMercator();

/**
 * 根据 GeoJSON 创建 3D 地图组
 * 每个 feature 对应一个区县，顶面按浅蓝配色表分色
 */
const createMap = (data) => {
  const map = new THREE.Object3D();

  // 取第一个区域的质心作为投影中心，使投影坐标以广州市为中心展开
  const center = data.features[0].properties.centroid;
  offsetXY.center(center).translate([0, 0]);

  data.features.forEach((feature, featureIndex) => {
    // unit：单个区县容器，可包含多个 polygon（含洞）
    const unit = new THREE.Object3D();
    const { centroid, center, name } = feature.properties;
    const { coordinates, type } = feature.geometry;
    const point = centroid || center || [0, 0];

   // 随机 HSL 色相固定为 233（蓝紫色系），饱和度和亮度随机
   const color = new THREE.Color(`hsl(
      ${233},
      ${Math.random() * 30 + 55}%,
      ${Math.random() * 30 + 55}%)`).getHex();
    const depth = Math.random() * 0.3 + 0.3; // 挤出高度随机，形成高低起伏

    const label = createLabel(name, point, depth);
    const icon = createIcon(center, depth);
    coordinates.forEach((coordinate) => {
      // MultiPolygon：多个独立多边形；Polygon：单个多边形（外环 + 可选内环/洞）
      if (type === "MultiPolygon") coordinate.forEach((item) => fn(item));
      if (type === "Polygon") fn(coordinate);

      function fn(coordinate) {
        unit.name = name;
        const mesh = createMesh(coordinate, color, depth);
        const line = createLine(coordinate, depth);
        unit.add(mesh, ...line);
      }
    });

    map.add(unit, label, icon);
    // 每添加一个区县后重新计算包围盒并居中（后续可优化为全部添加完再调用一次）
    setCenter(map);
  });
  return map;
};

/**
 * 将 GeoJSON 环坐标挤出为 3D 区块
 * @param {Array} data - 单个 polygon 环，形如 [[lng, lat], ...]
 * @param {number} topColor - 顶面十六进制颜色
 * @param {number} depth - 挤出深度（厚度）
 */
const createMesh = (data, color, depth) => {
  const shape = new THREE.Shape();

  data.forEach((item, idx) => {
    // 经纬度 → 墨卡托平面坐标
    const [x, y] = offsetXY(item);
    // y 取负：D3 坐标系 Y 轴向下，Three.js Y 轴向上，需翻转
    if (idx === 0) shape.moveTo(x, -y);
    else shape.lineTo(x, -y);
  });

  const extrudeSettings = {
    depth, // 沿 Z 轴挤出深度
    bevelEnabled: false, // 关闭倒角，保持区块边缘利落
  };
  const materialSettings = {
    color: color,
    emissive: 0x000000,
    roughness: 0.45,
    metalness: 0.8,
    transparent: true, // 配合点击高亮时的 opacity 变化
    side: THREE.DoubleSide,
  };
  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

  const material = new THREE.MeshStandardMaterial(materialSettings);
  const mesh = new THREE.Mesh(geometry, material);
  return mesh;
};

const createLine = (data, depth) => {
  const points = [];
  data.forEach((item) => {
    const [x, y] = offsetXY(item);
    points.push(new THREE.Vector3(x, -y, 0));
  });
  const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
  const uplineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
  const downlineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });

  const upLine = new THREE.Line(lineGeometry, uplineMaterial);
  const downLine = new THREE.Line(lineGeometry, downlineMaterial);
  downLine.position.z = -0.0001;
  upLine.position.z = depth + 0.0001;
  return [upLine, downLine];
};

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

const createIcon = (point, depth) => {
  const url = new URL("../assets/icon.png", import.meta.url).href;
  const map = new THREE.TextureLoader().load(url);
  const material = new THREE.SpriteMaterial({
    map: map,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  const [x, y] = offsetXY(point);
  sprite.scale.set(0.3, 0.3, 0.3);

  sprite.position.set(x, -y, depth + 0.2);
  sprite.renderOrder = 1;

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

  // 额外偏移量，可按需微调地图在场景中的位置
  const offset = [0, 0];
  map.position.x = map.position.x - center.x - offset[0];
  map.position.z = map.position.z - center.z - offset[1];
};
</script>

<style scoped>
/* 全屏容器，背景色与场景环境光颜色一致 */
#map {
  background-color: #dcebff;
}
</style>
