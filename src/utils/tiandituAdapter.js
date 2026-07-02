/**
 * 将天地图 JSON 统一转为 map.vue 可用的 GeoJSON FeatureCollection
 *
 * 支持两种来源：
 * 1. 天地图官网下载的 GeoJSON（已是 FeatureCollection，直接返回）
 * 2. 天地图行政区划 API 返回（boundary 字符串 + center 对象）
 */

/** 解析 API 的 boundary 字符串 → ring 坐标数组 */
const parseBoundary = (boundary) => {
  if (!boundary || typeof boundary !== "string") return [];
  return boundary
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [lng, lat] = pair.split(",").map(Number);
      return [lng, lat];
    })
    .filter(([lng, lat]) => !Number.isNaN(lng) && !Number.isNaN(lat));
};

/** 单个 API 行政区条目 → GeoJSON Feature */
const apiItemToFeature = (item) => {
  const ring = parseBoundary(item.boundary);
  const center = item.center
    ? [item.center.lng ?? item.center.lon, item.center.lat]
    : undefined;

  return {
    type: "Feature",
    properties: {
      name: item.name,
      gb: item.gb,
      ...(center ? { center } : {}),
    },
    geometry: {
      type: "Polygon",
      coordinates: ring.length ? [ring] : [],
    },
  };
};

/**
 * @param {Object|Array} data - 天地图下载 GeoJSON 或 API 响应
 * @returns {Object} GeoJSON FeatureCollection
 */
export const normalizeTiandituData = (data) => {
  // 已是标准 GeoJSON
  if (data?.type === "FeatureCollection" && Array.isArray(data.features)) {
    return data;
  }

  // 单个 Feature
  if (data?.type === "Feature") {
    return { type: "FeatureCollection", features: [data] };
  }

  // API：{ result: [...] } / { data: [...] } / 数组
  const list = Array.isArray(data)
    ? data
    : data?.result || data?.data || data?.districts || [data];

  const features = list
    .filter((item) => item?.boundary || item?.geometry)
    .map((item) =>
      item.geometry ? item : apiItemToFeature(item),
    );

  return { type: "FeatureCollection", features };
};
