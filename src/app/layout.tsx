import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "版色アトラス — hanshoku-atlas",
  description:
    "浮世絵の版ごとの平面色(版色)を復元して測る。測っているのは「メトロポリタン美術館が公開した画像において、k-means が復元した版色の分布」であって、摺られた当時の色ではない。",
};

// フリート共通のフッタ規約(koho-lens が正本)。
// MIT License ・ © ・ GitHub ・ 歩き方 ・ 設計図 ・ App Menu の 6 項目をこの並びで、
// position: fixed で常時表示する。**並びと項目数を揃えるのであって、文言は各アプリのものを残す。**
const FOOTER = {
  license: "https://github.com/twill3c/hanshoku-atlas/blob/main/LICENSE",
  repository: "https://github.com/twill3c/hanshoku-atlas",
  guide: "https://claude.ai/code/artifact/53dcce2c-f144-4615-8418-d3e3faad5be7",
  blueprint: "https://claude.ai/code/artifact/5a6c3bad-00fc-463d-ad9a-55b0710b1b53",
  appMenu: "https://app-menu-amber.vercel.app/",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        {children}
        {/* fleet: fixed footer */}
        <footer className="fleet-footer">
          <div className="fleet-footer__inner">
            <a href={FOOTER.license}>MIT License</a>
            <span className="fleet-footer__copy">© 2026 坂田哲朗</span>
            <a href={FOOTER.repository}>GitHub</a>
            <a href={FOOTER.guide}>版色アトラスの歩き方</a>
            <a href={FOOTER.blueprint}>版色アトラスの設計図</a>
            <a href={FOOTER.appMenu}>App Menu</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
