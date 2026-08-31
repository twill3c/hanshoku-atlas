//! hanshoku コア —— 重み付き k-means の第二実装(F-08 / G-08)。
//!
//! **TS 実装 `src/core/kmeans.ts` とビット一致すること**が要求である。速度は副産物にすぎない。
//!
//! ビット一致が理論上ありうるかを先に確かめてある(HC-073):
//!   - この関数が使う演算は **加減乗除・比較・平方根**だけで、IEEE-754 で結果が一意に定まる
//!   - **超越関数を使わない。** `cbrt` / `pow` は実装ごとに最終桁が違いうるので、
//!     sRGB → OKLab の変換は**この境界の外**(JS 側)に置いた。WASM が受け取るのは
//!     変換済みの OKLab 点と重みである
//!   - 総和の順序は TS 実装と 1 命令ずつ揃えてある。順序が違えば値も違う
//!
//! 達成不能な閾値を掲げない —— 上の条件が崩れる変更をしたら、閾値の方を先に見直すこと。

// ---------------------------------------------------------------- mulberry32

/// フリート共通 PRNG。TS の `src/core/rng.ts` と同じ仕様。
/// **一致は T-023 が多数のシードで実測する**(移植したから同じ、とは扱わない)。
pub struct Mulberry32 {
    state: u32,
}

impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    pub fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b_79f5);
        let a = self.state;
        let mut t = (a ^ (a >> 15)).wrapping_mul(1 | a);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }
}

// ---------------------------------------------------------------- 状態

static mut POINTS: Vec<f64> = Vec::new();
static mut WEIGHTS: Vec<f64> = Vec::new();
static mut CENTROIDS: Vec<f64> = Vec::new();
static mut ASSIGN: Vec<u32> = Vec::new();
static mut CWEIGHTS: Vec<f64> = Vec::new();
static mut INERTIA_TRACE: Vec<f64> = Vec::new();
static mut CHANGES_TRACE: Vec<u32> = Vec::new();
static mut INERTIA: f64 = 0.0;

/// 入力・出力の領域を確保する。JS はこの後 `points_ptr` / `weights_ptr` に書き込む。
#[no_mangle]
pub extern "C" fn alloc(n: usize, k: usize, max_iter: usize) {
    unsafe {
        POINTS.clear();
        POINTS.resize(n * 3, 0.0);
        WEIGHTS.clear();
        WEIGHTS.resize(n, 0.0);
        CENTROIDS.clear();
        CENTROIDS.resize(k * 3, 0.0);
        ASSIGN.clear();
        ASSIGN.resize(n, 0);
        CWEIGHTS.clear();
        CWEIGHTS.resize(k, 0.0);
        INERTIA_TRACE.clear();
        INERTIA_TRACE.reserve(max_iter);
        CHANGES_TRACE.clear();
        CHANGES_TRACE.reserve(max_iter);
    }
}

#[no_mangle]
pub extern "C" fn points_ptr() -> *mut f64 {
    unsafe { POINTS.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn weights_ptr() -> *mut f64 {
    unsafe { WEIGHTS.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn centroids_ptr() -> *const f64 {
    unsafe { CENTROIDS.as_ptr() }
}

#[no_mangle]
pub extern "C" fn assign_ptr() -> *const u32 {
    unsafe { ASSIGN.as_ptr() }
}

#[no_mangle]
pub extern "C" fn cweights_ptr() -> *const f64 {
    unsafe { CWEIGHTS.as_ptr() }
}

#[no_mangle]
pub extern "C" fn inertia_trace_ptr() -> *const f64 {
    unsafe { INERTIA_TRACE.as_ptr() }
}

#[no_mangle]
pub extern "C" fn changes_trace_ptr() -> *const u32 {
    unsafe { CHANGES_TRACE.as_ptr() }
}

#[no_mangle]
pub extern "C" fn trace_len() -> usize {
    unsafe { INERTIA_TRACE.len() }
}

#[no_mangle]
pub extern "C" fn inertia() -> f64 {
    unsafe { INERTIA }
}

// ---------------------------------------------------------------- k-means

#[inline]
fn sq_dist(p: &[f64], i: usize, c: &[f64], j: usize) -> f64 {
    let d0 = p[i * 3] - c[j * 3];
    let d1 = p[i * 3 + 1] - c[j * 3 + 1];
    let d2 = p[i * 3 + 2] - c[j * 3 + 2];
    d0 * d0 + d1 * d1 + d2 * d2
}

/// k-means++ の初期中心。**TS の `initPlusPlus` と同じ順序で乱数を消費する。**
fn init_plus_plus(points: &[f64], weights: &[f64], k: usize, rng: &mut Mulberry32) -> Vec<f64> {
    let n = weights.len();
    let mut centroids = vec![0.0f64; k * 3];
    let mut best = vec![f64::INFINITY; n];

    let mut total = 0.0f64;
    for w in weights.iter() {
        total += *w;
    }
    let mut target = rng.next_f64() * total;
    let mut first = n - 1;
    for i in 0..n {
        target -= weights[i];
        if target <= 0.0 {
            first = i;
            break;
        }
    }
    centroids[0] = points[first * 3];
    centroids[1] = points[first * 3 + 1];
    centroids[2] = points[first * 3 + 2];

    for c in 1..k {
        let mut sum = 0.0f64;
        for i in 0..n {
            let d = sq_dist(points, i, &centroids, c - 1);
            if d < best[i] {
                best[i] = d;
            }
            sum += best[i] * weights[i];
        }
        let mut t = rng.next_f64() * sum;
        let mut pick = n - 1;
        for i in 0..n {
            t -= best[i] * weights[i];
            if t <= 0.0 {
                pick = i;
                break;
            }
        }
        centroids[c * 3] = points[pick * 3];
        centroids[c * 3 + 1] = points[pick * 3 + 1];
        centroids[c * 3 + 2] = points[pick * 3 + 2];
    }
    centroids
}

/// 先頭 k 点を初期中心に採る。**陽性対照専用**(G-04)。
fn init_first(points: &[f64], k: usize) -> Vec<f64> {
    let mut centroids = vec![0.0f64; k * 3];
    for c in 0..k {
        centroids[c * 3] = points[c * 3];
        centroids[c * 3 + 1] = points[c * 3 + 1];
        centroids[c * 3 + 2] = points[c * 3 + 2];
    }
    centroids
}

/// k-means を回す。返すのは反復回数。
///
/// - `init`: 0 = k-means++、1 = 退化(先頭 k 点)
/// - `variant`: 0 = 通常、**1 = 経路だけをずらす**(収束を 2 回連続で要求する)。
///   variant 1 は**同じ答えに別の経路で着く** —— 結論だけを比べる照合は
///   これを緑のまま通す。G-08 の陽性対照はこれである(HC-065)。
#[no_mangle]
pub extern "C" fn run(k: usize, seed: u32, max_iter: usize, tol: f64, init: u32, variant: u32) -> u32 {
    unsafe {
        let n = WEIGHTS.len();
        let mut rng = Mulberry32::new(seed);
        let mut centroids = if init == 1 {
            init_first(&POINTS, k)
        } else {
            init_plus_plus(&POINTS, &WEIGHTS, k, &mut rng)
        };

        for a in ASSIGN.iter_mut() {
            *a = 0xffff_ffff;
        }
        let mut sums = vec![0.0f64; k * 3];
        let mut wsum = vec![0.0f64; k];
        INERTIA_TRACE.clear();
        CHANGES_TRACE.clear();

        let mut iterations = 0usize;
        let mut settled = 0u32;

        for iter in 0..max_iter {
            iterations = iter + 1;
            let mut changes = 0u32;
            let mut obj = 0.0f64;
            for s in sums.iter_mut() {
                *s = 0.0;
            }
            for w in wsum.iter_mut() {
                *w = 0.0;
            }

            for i in 0..n {
                let mut best_j = 0usize;
                let mut best_d = f64::INFINITY;
                for j in 0..k {
                    let d = sq_dist(&POINTS, i, &centroids, j);
                    if d < best_d {
                        best_d = d;
                        best_j = j;
                    }
                }
                if ASSIGN[i] != best_j as u32 {
                    ASSIGN[i] = best_j as u32;
                    changes += 1;
                }
                let w = WEIGHTS[i];
                obj += best_d * w;
                wsum[best_j] += w;
                sums[best_j * 3] += POINTS[i * 3] * w;
                sums[best_j * 3 + 1] += POINTS[i * 3 + 1] * w;
                sums[best_j * 3 + 2] += POINTS[i * 3 + 2] * w;
            }

            INERTIA_TRACE.push(obj);
            CHANGES_TRACE.push(changes);

            // 空クラスタは、最も遠い点を割り当て直して埋める
            for j in 0..k {
                if wsum[j] > 0.0 {
                    continue;
                }
                let mut far = 0usize;
                let mut far_d = -1.0f64;
                for i in 0..n {
                    let d = sq_dist(&POINTS, i, &centroids, ASSIGN[i] as usize);
                    if d > far_d {
                        far_d = d;
                        far = i;
                    }
                }
                centroids[j * 3] = POINTS[far * 3];
                centroids[j * 3 + 1] = POINTS[far * 3 + 1];
                centroids[j * 3 + 2] = POINTS[far * 3 + 2];
                wsum[j] = 0.0;
            }

            let mut next = vec![0.0f64; k * 3];
            for j in 0..k {
                if wsum[j] > 0.0 {
                    next[j * 3] = sums[j * 3] / wsum[j];
                    next[j * 3 + 1] = sums[j * 3 + 1] / wsum[j];
                    next[j * 3 + 2] = sums[j * 3 + 2] / wsum[j];
                } else {
                    next[j * 3] = centroids[j * 3];
                    next[j * 3 + 1] = centroids[j * 3 + 1];
                    next[j * 3 + 2] = centroids[j * 3 + 2];
                }
            }

            let mut shift = 0.0f64;
            for j in 0..(k * 3) {
                shift += (next[j] - centroids[j]) * (next[j] - centroids[j]);
            }
            centroids = next;

            if changes == 0 && shift <= tol {
                settled += 1;
                if settled > variant {
                    break;
                }
            } else {
                settled = 0;
            }
        }

        // 最後の重心に対して割当と慣性を取り直す
        let mut obj = 0.0f64;
        for w in wsum.iter_mut() {
            *w = 0.0;
        }
        for i in 0..n {
            let mut best_j = 0usize;
            let mut best_d = f64::INFINITY;
            for j in 0..k {
                let d = sq_dist(&POINTS, i, &centroids, j);
                if d < best_d {
                    best_d = d;
                    best_j = j;
                }
            }
            ASSIGN[i] = best_j as u32;
            obj += best_d * WEIGHTS[i];
            wsum[best_j] += WEIGHTS[i];
        }
        INERTIA = obj;
        CENTROIDS.copy_from_slice(&centroids);
        CWEIGHTS.copy_from_slice(&wsum);

        iterations as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prng_is_in_unit_interval() {
        let mut r = Mulberry32::new(20260831);
        for _ in 0..10000 {
            let v = r.next_f64();
            assert!((0.0..1.0).contains(&v));
        }
    }

    #[test]
    fn sq_dist_is_symmetric() {
        let p = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
        assert_eq!(sq_dist(&p, 0, &p, 1), sq_dist(&p, 1, &p, 0));
    }
}
