import { writeFileSync } from "node:fs";

// Centerlines of assets/symbol-paired.svg: 28-unit stems, 42/14-unit outer/inner radii.
const handle = 28 * 4 * (Math.sqrt(2) - 1) / 3;
function arch(offset) {
  return {
    c: false,
    v: [[14 + offset, 120], [14 + offset, 42], [42 + offset, 14], [70 + offset, 42], [70 + offset, 120]],
    i: [[0, 0], [0, 0], [-handle, 0], [0, -handle], [0, 0]],
    o: [[0, 0], [0, -handle], [handle, 0], [0, 0], [0, 0]],
  };
}

const left = arch(0);
const right = arch(56);
const fixed = value => ({ a: 0, k: value });
const archFrames = 42;
const colorOverlap = 6;
const redStart = archFrames * 2 - colorOverlap;

function trim(start, duration) {
  return {
    a: 1,
    k: [
      {
        t: start, s: [0],
        o: { x: [1 / 3], y: [1 / 3] },
        i: { x: [2 / 3], y: [2 / 3] },
      },
      { t: start + duration, s: [100] },
    ],
  };
}

function paint(name, color, path, start, end, clearStart) {
  return {
    ty: 4, nm: name, ddd: 0, sr: 1,
    ip: 0, op: end, st: 0, ao: 0, bm: 0,
    ks: {
      o: fixed(100), r: fixed(0), p: fixed([70, 50, 0]),
      a: fixed([0, 0, 0]), s: fixed([100, 100, 100]),
    },
    shapes: [
      { ty: "sh", nm: "Arch centerline", ks: fixed(path) },
      {
        ty: "st", nm: name, c: fixed([...color.map(channel => channel / 255), 1]),
        // A bevel keeps the center turnaround flat at the baseline.
        o: fixed(100), w: fixed(28), lc: 1, lj: 3,
      },
      {
        ty: "tm", nm: "Painted bounce",
        s: clearStart === undefined ? fixed(0) : trim(clearStart, archFrames),
        o: fixed(0), m: 1, e: trim(start, archFrames),
      },
    ],
  };
}

function animation(allArches) {
  const blueStart = redStart + archFrames * (allArches ? 2 : 1) - colorOverlap;
  const blueFinish = blueStart + archFrames * 2;
  const clearStart = allArches ? blueFinish : blueStart + archFrames;
  const finishFrame = clearStart + archFrames;
  const endFrame = finishFrame + 24;
  return {
    v: "5.13.0", fr: 60, ip: 0, op: endFrame, w: 280, h: 220, ddd: 0,
    nm: `Monk - Painted bounce - ${allArches ? "All arches" : "Different stops"}`, assets: [],
    layers: [
      paint("Scissors blue second bounce", [105, 181, 245], right, blueStart + archFrames, endFrame),
      paint("Scissors blue first bounce", [105, 181, 245], left, blueStart, endFrame, clearStart),
      ...(allArches ? [paint("Rock red second bounce", [235, 98, 86], right, redStart + archFrames, finishFrame)] : []),
      paint("Rock red first bounce", [235, 98, 86], left, redStart, endFrame),
      paint("Paper yellow second bounce", [242, 207, 69], right, archFrames, finishFrame),
      paint("Paper yellow first bounce", [242, 207, 69], left, 0, finishFrame),
    ].map((layer, index) => ({ ...layer, ind: index + 1 })),
    markers: [
      { tm: 0, cm: "Yellow leads", dr: redStart },
      { tm: redStart, cm: "Red follows", dr: blueStart - redStart },
      { tm: blueStart, cm: "Blue completes both arches", dr: blueFinish - blueStart },
      { tm: clearStart, cm: "Blue reveals red", dr: archFrames },
      { tm: finishFrame, cm: "Finished mark", dr: endFrame - finishFrame },
    ],
  };
}

writeFileSync(new URL("../brand/assets/monk-entrance.json", import.meta.url), `${JSON.stringify(animation(false))}\n`);
writeFileSync(new URL("../brand/assets/monk-entrance-all-arches.json", import.meta.url), `${JSON.stringify(animation(true))}\n`);
