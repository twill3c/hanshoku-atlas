// 画素バッファの最小の型。canvas の ImageData と同じ形をしているが、
// **ブラウザに依存しない** —— テストは Node 上で生の配列を作って渡す。

export type RasterImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};
