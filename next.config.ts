import type { NextConfig } from "next";

// 静的書き出しのみ。サーバ関数を一つも持たない(SPEC N-01)。
// 画像は閲覧者のブラウザが images.metmuseum.org から直接取得する。
// **ビルド時に外部へ取りに行かない**(N-02)。リポジトリにも out/ にも Met の画像は置かない(N-03)。
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  trailingSlash: true,
};

export default nextConfig;
