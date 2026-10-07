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

function keyframe(time, value, outgoing = 1 / 3, incoming = 2 / 3) {
  return {
    t: time, s: Array.isArray(value) ? value : [value],
    o: { x: [1 / 3], y: [outgoing] },
    i: { x: [2 / 3], y: [incoming] },
  };
}

function trim(start, duration, realistic = false) {
  return {
    a: 1,
    k: [
      ...(realistic ? [
        keyframe(start, 0, 2 / 3, 1),
        keyframe(start + duration / 2, 50, 0, 1 / 3),
      ] : [keyframe(start, 0)]),
      { t: start + duration, s: [100] },
    ],
  };
}

function paint(name, color, path, start, duration, end, clearStart, realistic = false) {
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
        s: clearStart === undefined ? fixed(0) : trim(clearStart, duration),
        o: fixed(0), m: 1, e: trim(start, duration, realistic),
      },
    ],
  };
}

function risingOutline(name, path, start, duration, realistic = false) {
  const upward = {
    c: false, v: path.v.slice(0, 3), i: path.i.slice(0, 3), o: path.o.slice(0, 3),
  };
  const end = start + duration / 2;
  const outline = paint(`${name} upward outline`, [255, 255, 255], upward, start, duration / 2, end);
  outline.ip = start;
  outline.shapes[1].w = fixed(32);
  // A small leading white edge separates a rising stroke from paint already beneath it.
  const lead = 200 / (78 + Math.PI * 14);
  outline.shapes[2].e = {
    a: 1,
    k: [
      keyframe(start, lead, realistic ? 2 / 3 : 1 / 3, realistic ? 1 : 2 / 3),
      { t: end, s: [100] },
    ],
  };
  return outline;
}

function outlinedPaint(name, color, path, start, duration, end, clearStart, realistic = false) {
  return [
    paint(name, color, path, start, duration, end, clearStart, realistic),
    risingOutline(name, path, start, duration, realistic),
  ];
}

function animation(allArches, realistic = false) {
  const duration = realistic ? 30 : allArches ? archFrames / 2 : archFrames;
  const overlap = allArches ? colorOverlap / 2 : colorOverlap;
  const secondStart = duration * 2 - overlap;
  const thirdStart = secondStart + duration * (allArches ? 2 : 1) - overlap;
  const clearStart = thirdStart + duration * (allArches ? 2 : 1);
  const finishFrame = clearStart + duration;
  const endFrame = finishFrame + (realistic ? 18 : allArches ? 12 : 24);
  const redStart = allArches ? thirdStart : secondStart;
  const blueStart = allArches ? secondStart : thirdStart;
  const redLeft = outlinedPaint("Rock red first bounce", [235, 98, 86], left, redStart, duration, endFrame, undefined, realistic);
  const blueRight = paint("Scissors blue second bounce", [105, 181, 245], right, blueStart + duration, duration, endFrame, undefined, realistic);
  const blueRightOutline = risingOutline("Scissors blue second bounce", right, blueStart + duration, duration, realistic);
  const layers = allArches ? [
    ...outlinedPaint("Rock red second bounce", [235, 98, 86], right, redStart + duration, duration, endFrame, clearStart, realistic),
    // Move blue above the red overlap only after red has painted both bounces.
    { ...blueRight, nm: "Scissors blue final arch", ip: clearStart },
    ...redLeft,
    { ...blueRight, op: clearStart },
    blueRightOutline,
    ...outlinedPaint("Scissors blue first bounce", [105, 181, 245], left, blueStart, duration, finishFrame, undefined, realistic),
  ] : [
    blueRight,
    blueRightOutline,
    ...outlinedPaint("Scissors blue first bounce", [105, 181, 245], left, blueStart, duration, endFrame, clearStart),
    ...redLeft,
  ];
  return {
    v: "5.13.0", fr: allArches && !realistic ? 120 : 60, ip: 0, op: endFrame, w: 280, h: 220, ddd: 0,
    nm: `Monk - Painted bounce - ${realistic ? "Realistic bounce" : allArches ? "All arches" : "Different stops"}`, assets: [],
    layers: [
      ...layers,
      ...outlinedPaint("Paper yellow second bounce", [242, 207, 69], right, duration, duration, finishFrame, undefined, realistic),
      ...outlinedPaint("Paper yellow first bounce", [242, 207, 69], left, 0, duration, finishFrame, undefined, realistic),
    ].map((layer, index) => ({ ...layer, ind: index + 1 })),
    markers: [
      { tm: 0, cm: "Yellow leads", dr: secondStart },
      { tm: secondStart, cm: allArches ? "Blue follows" : "Red follows", dr: thirdStart - secondStart },
      { tm: thirdStart, cm: allArches ? "Red completes both arches" : "Blue completes both arches", dr: duration * 2 },
      { tm: clearStart, cm: allArches ? "Red reveals blue" : "Blue reveals red", dr: duration },
      { tm: finishFrame, cm: "Finished mark", dr: endFrame - finishFrame },
    ],
  };
}

function loadingAnimation() {
  const duration = archFrames / 2;
  const end = duration * 6;
  return {
    v: "5.13.0", fr: 60, ip: 0, op: end, w: 280, h: 220, ddd: 0,
    nm: "Monk - Loading bounce sweep", assets: [],
    layers: [
      ...outlinedPaint("Rock red second bounce", [235, 98, 86], right, duration * 5, duration, end, undefined, true),
      ...outlinedPaint("Rock red first bounce", [235, 98, 86], left, duration * 4, duration, end, undefined, true),
      ...outlinedPaint("Scissors blue second bounce", [105, 181, 245], right, duration * 3, duration, end, undefined, true),
      ...outlinedPaint("Scissors blue first bounce", [105, 181, 245], left, duration * 2, duration, end, undefined, true),
      ...outlinedPaint("Paper yellow second bounce", [242, 207, 69], right, duration, duration, end, undefined, true),
      ...outlinedPaint("Paper yellow first bounce", [242, 207, 69], left, 0, duration, end, undefined, true),
      // Prepainted red keeps the whole m visible and joins the end of the cycle to its start.
      paint("Rock red underlay right", [235, 98, 86], right, -duration, duration, end),
      paint("Rock red underlay left", [235, 98, 86], left, -duration, duration, end),
    ].map((layer, index) => ({ ...layer, ind: index + 1 })),
    markers: [
      { tm: 0, cm: "Yellow sweep", dr: duration * 2 },
      { tm: duration * 2, cm: "Blue sweep", dr: duration * 2 },
      { tm: duration * 4, cm: "Red sweep", dr: duration * 2 },
    ],
  };
}

function wordmarkAnimation() {
  const entrance = animation(true, true);
  const moveStart = entrance.op;
  const revealStart = moveStart + 33;
  const finish = revealStart + 27;
  const end = finish + 48;
  const scale = 240 / 522;
  const wordmarkY = 110 - 80 * scale;
  const move = (from, to) => ({
    a: 1,
    k: [keyframe(moveStart, from, 2 / 3, 1), { t: revealStart, s: to }],
  });
  const layers = entrance.layers.map(layer => layer.op === entrance.op ? {
    ...layer,
    op: end,
    ks: {
      ...layer.ks,
      p: move([70, 50, 0], [20, wordmarkY + 40 * scale, 0]),
      s: move([100, 100, 100], [100 * scale, 100 * scale, 100]),
    },
  } : layer);
  const ink = fixed([23 / 255, 23 / 255, 25 / 255, 1]);
  const fill = { ty: "fl", c: ink, o: fixed(100), r: 2 };
  const n = arch(292);
  n.v = n.v.map(([x, y]) => [x, y + 40]);
  const k = [[408, 0], [436, 0], [436, 91], [484, 40], [520, 40], [466, 98],
    [522, 160], [485, 160], [436, 105], [436, 160], [408, 160]];
  const letters = [
    [
      { ty: "el", nm: "Outer o", d: 1, p: fixed([218, 100]), s: fixed([104, 120]) },
      { ty: "el", nm: "Inner o", d: 1, p: fixed([218, 100]), s: fixed([48, 64]) },
      fill,
    ],
    [
      { ty: "sh", nm: "n centerline", ks: fixed(n) },
      { ty: "st", c: ink, o: fixed(100), w: fixed(28), lc: 1, lj: 3 },
    ],
    [
      { ty: "sh", nm: "k outline", ks: fixed({
        c: true, v: k, i: k.map(() => [0, 0]), o: k.map(() => [0, 0]),
      }) },
      fill,
    ],
  ].map((shapes, index) => {
    const start = revealStart + index * 6;
    return {
      ty: 4, nm: `Wordmark ${"onk"[index]}`, ddd: 0, sr: 1,
      ip: start, op: end, st: 0, ao: 0, bm: 0,
      ks: {
        o: { a: 1, k: [keyframe(start, 0, 2 / 3, 1), { t: start + 15, s: [100] }] },
        r: fixed(0), p: fixed([20, wordmarkY, 0]),
        a: fixed([0, 0, 0]), s: fixed([100 * scale, 100 * scale, 100]),
      },
      shapes,
    };
  });
  return {
    ...entrance, nm: "Monk - Painted bounce - Wordmark reveal", op: end,
    layers: [...letters, ...layers].map((layer, index) => ({ ...layer, ind: index + 1 })),
    markers: [
      ...entrance.markers,
      { tm: moveStart, cm: "Move m left", dr: revealStart - moveStart },
      { tm: revealStart, cm: "Reveal onk", dr: finish - revealStart },
      { tm: finish, cm: "Finished wordmark", dr: end - finish },
    ],
  };
}

writeFileSync(new URL("../brand/assets/monk-entrance.json", import.meta.url), `${JSON.stringify(animation(false))}\n`);
writeFileSync(new URL("../brand/assets/monk-entrance-all-arches.json", import.meta.url), `${JSON.stringify(animation(true))}\n`);
writeFileSync(new URL("../brand/assets/monk-loading.json", import.meta.url), `${JSON.stringify(loadingAnimation())}\n`);
writeFileSync(new URL("../brand/assets/monk-entrance-realistic.json", import.meta.url), `${JSON.stringify(animation(true, true))}\n`);
writeFileSync(new URL("../brand/assets/monk-entrance-wordmark.json", import.meta.url), `${JSON.stringify(wordmarkAnimation())}\n`);
