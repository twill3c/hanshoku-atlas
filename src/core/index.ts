// core の公開口。**パイプラインは出荷しているのと同じ実装を読む**(HC-069)。
export * from "./color";
export * from "./image";
export * from "./rng";
export * from "./kmeans";
export * from "./extract";
export * from "./wasm";
export * from "./spread";
export * from "./years";
export * from "./iro";
export * from "./design";
// 合成木版と劣化の模型。**出荷するページはこれを import しない**(パイプラインと検査だけが使う)。
// index.ts に並べても T-016(循環の禁止)は破れない —— あれは extract.ts / kmeans.ts の
// ソースが synth を参照していないことを見ている
export * from "./synth";
export * from "./degrade";
export * from "./met";
