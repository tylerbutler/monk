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
const both = {
  c: false,
  v: [...left.v, ...right.v.slice(1)],
  i: [...left.i, ...right.i.slice(1)],
  o: [...left.o, ...right.o.slice(1)],
};
const fixed = value => ({ a: 0, k: value });

function paint(name, index, color, path, beats, end = 120) {
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
        o: fixed(100), w: fixed(28), lc: 1, lj: 2,
      },
      {
        ty: "tm", nm: "Painted bounce", s: fixed(0), o: fixed(0), m: 1,
        e: {
          a: 1,
          k: beats.map(([t, value], index) => ({
            t, s: [value],
            // Slow toward each apex; accelerate toward each landing.
            o: { x: [index % 2 === 0 ? .17 : .67], y: [index % 2 === 0 ? .67 : 0] },
            i: { x: [index % 2 === 0 ? .33 : .83], y: [index % 2 === 0 ? 1 : .33] },
          })),
        },
      },
    ],
  };
}

const animation = {
  v: "5.13.0", fr: 60, ip: 0, op: 120, w: 280, h: 220, ddd: 0,
  nm: "Monk - Painted bounce", assets: [],
  layers: [
    paint("Scissors blue", 1, [105, 181, 245], right, [[48, 0], [70, 50], [92, 100]]),
    paint("Rock red", 2, [235, 98, 86], left, [[10, 0], [30, 50], [50, 100]]),
    paint("Paper yellow", 3, [242, 207, 69], both, [[0, 0], [18, 25], [36, 50], [54, 75], [72, 100]], 94),
  ],
  markers: [
    { tm: 0, cm: "Yellow leads", dr: 10 },
    { tm: 10, cm: "Red follows", dr: 38 },
    { tm: 48, cm: "Blue completes", dr: 46 },
    { tm: 94, cm: "Finished mark", dr: 26 },
  ],
};

writeFileSync(new URL("../brand/assets/monk-entrance.json", import.meta.url), `${JSON.stringify(animation)}\n`);
