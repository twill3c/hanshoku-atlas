import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "版色アトラス — hanshoku-atlas",
  description:
    "浮世絵の版ごとの平面色(版色)を復元して測る。測っているのは「メトロポリタン美術館が公開した画像において、k-means が復元した版色の分布」であって、摺られた当時の色ではない。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        {children}
        {/* fleet: fixed footer */}
        <footer className="fleet-footer">
          MIT License © 2026 坂田哲朗 ・{" "}
          <a href="https://github.com/twill3c/hanshoku-atlas" target="_blank" rel="noopener">
            GitHub
          </a>{" "}
          ・{" "}
          <a href="https://app-menu-amber.vercel.app" target="_blank" rel="noopener">
            App Menu
          </a>
        </footer>
      </body>
    </html>
  );
}
