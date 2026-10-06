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
const colorDelay = 12;
const finishFrame = colorDelay + archFrames * 2;

function paint(name, index, color, path, start, duration, end = 120) {
  return {
    ty: 4, nm: name, ind: index, ddd: 0, sr: 1,
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
        ty: "tm", nm: "Painted bounce", s: fixed(0), o: fixed(0), m: 1,
        e: {
          a: 1,
          k: [
            {
              t: start, s: [0],
              o: { x: [1 / 3], y: [1 / 3] },
              i: { x: [2 / 3], y: [2 / 3] },
            },
            { t: start + duration, s: [100] },
          ],
        },
      },
    ],
  };
}

const animation = {
  v: "5.13.0", fr: 60, ip: 0, op: 120, w: 280, h: 220, ddd: 0,
  nm: "Monk - Painted bounce", assets: [],
  layers: [
    paint("Scissors blue", 1, [105, 181, 245], right, colorDelay + archFrames, archFrames),
    paint("Paper yellow second bounce", 2, [242, 207, 69], right, archFrames, archFrames, finishFrame),
    paint("Rock red", 3, [235, 98, 86], left, colorDelay, archFrames),
    paint("Paper yellow first bounce", 4, [242, 207, 69], left, 0, archFrames, finishFrame),
  ],
  markers: [
    { tm: 0, cm: "Yellow leads", dr: colorDelay },
    { tm: colorDelay, cm: "Red follows", dr: archFrames },
    { tm: colorDelay + archFrames, cm: "Blue completes", dr: archFrames },
    { tm: finishFrame, cm: "Finished mark", dr: 120 - finishFrame },
  ],
};

writeFileSync(new URL("../brand/assets/monk-entrance.json", import.meta.url), `${JSON.stringify(animation)}\n`);
