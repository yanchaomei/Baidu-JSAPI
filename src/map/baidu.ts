type BaiduMap = {
  centerAndZoom(point: unknown, zoom: number): void;
  enableScrollWheelZoom(): void;
  destroy(): void;
};
type BaiduSDK = {
  Map: new (element: HTMLElement) => BaiduMap;
  Point: new (lng: number, lat: number) => unknown;
  WebGLLayer?: unknown;
};
declare global {
  interface Window {
    BMapGL?: BaiduSDK;
    __baiduReady?: () => void;
  }
}

let sdkPromise: Promise<BaiduSDK> | null = null;
let sdkAK: string | null = null;

function loadSDK(ak: string) {
  if (
    (sdkAK !== null && sdkAK !== ak) ||
    (window.BMapGL?.Map && sdkAK === null)
  ) {
    return Promise.reject(
      new Error(
        "当前页面已加载另一份或未知 AK 的 SDK，请刷新页面后使用新 AK 重新检查",
      ),
    );
  }
  if (window.BMapGL?.Map) return Promise.resolve(window.BMapGL);
  if (sdkPromise) return sdkPromise;
  sdkAK = ak;
  sdkPromise = new Promise<BaiduSDK>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = window.setTimeout(
      () => finish(new Error("百度 SDK 加载超时，请检查网络与来源权限")),
      18000,
    );
    const finish = (error?: Error) => {
      clearTimeout(timer);
      delete window.__baiduReady;
      if (error) {
        script.remove();
        sdkPromise = null;
        sdkAK = null;
        reject(error);
      } else if (window.BMapGL?.Map) resolve(window.BMapGL);
      else {
        script.remove();
        sdkPromise = null;
        sdkAK = null;
        reject(new Error("SDK 未提供 BMapGL.Map，请检查浏览器端 AK"));
      }
    };
    window.__baiduReady = () => finish();
    script.onerror = () =>
      finish(new Error("无法加载百度 SDK，请检查网络与内容拦截设置"));
    // Browser AK is required by the official SDK URL; it is never exported by this application.
    script.src = `https://api.map.baidu.com/api?v=1.0&type=webgl&ak=${encodeURIComponent(ak)}&callback=__baiduReady`;
    document.head.append(script);
  });
  return sdkPromise;
}

export async function checkBaidu(ak: string, container: HTMLElement) {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(ak))
    throw new Error("请输入有效的浏览器端 AK");
  const sdk = await loadSDK(ak);
  const map = new sdk.Map(container);
  map.centerAndZoom(new sdk.Point(121.5, 31.25), 14);
  map.enableScrollWheelZoom();
  return {
    map,
    status:
      typeof sdk.WebGLLayer === "function"
        ? "SDK 提供目标构造函数；回调、坐标与业务绘制仍需按主办方合同验证。当前仅显示基图。"
        : "基图已初始化；当前 SDK 未导出 BMapGL.WebGLLayer，业务图层接入未通过。",
    capability: typeof sdk.WebGLLayer === "function",
  };
}
