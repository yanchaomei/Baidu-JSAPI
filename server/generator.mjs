import {
  HEADER_BYTES,
  STRIDE_FLOATS,
  MAGIC,
  VERSION,
  MAX_FRAME_BYTES,
  GENERATION_LIMITS,
} from "../src/data/protocol.ts";

const COLUMNS = 5;
const ROWS = 4;
const X_STREETS = Array.from(
  { length: COLUMNS + 1 },
  (_, index) => -0.92 + (index * 1.84) / COLUMNS,
);
const Y_STREETS = Array.from(
  { length: ROWS + 1 },
  (_, index) => -0.86 + (index * 1.72) / ROWS,
);
const FACTORY_COLOR = [0.075, 0.24, 0.28, 0.72];
const LOGISTICS_COLOR = [0.09, 0.21, 0.31, 0.76];
const ENERGY_COLOR = [0.19, 0.24, 0.21, 0.76];
const MAIN_PIPE_COLOR = [0.14, 0.46, 0.49, 0.72];
const BRANCH_PIPE_COLOR = [0.1, 0.34, 0.37, 0.6];
const DEVICE_COLORS = [
  [0.1, 0.84, 0.7, 0.74],
  [0.18, 0.7, 0.75, 0.68],
  [0.22, 0.94, 0.75, 0.72],
];
const WARNING_COLOR = [1, 0.68, 0.22, 0.96];
const ALERT_COLOR = [1, 0.29, 0.35, 1];
const ENERGY_CELL_COLOR = [0.12, 0.4, 0.34, 0.58];
const MICRO_PIPE_COLOR = [0.17, 0.51, 0.48, 0.54];

// Fixed-size scene descriptors; device count never changes their memory use.
const BUILDINGS = [];
for (let row = 0; row < ROWS; row++) {
  for (let column = 0; column < COLUMNS; column++) {
    const centerX = (X_STREETS[column] + X_STREETS[column + 1]) / 2;
    const centerY = (Y_STREETS[row] + Y_STREETS[row + 1]) / 2;
    const color =
      column === COLUMNS - 1
        ? ENERGY_COLOR
        : column === 0 && row < 2
          ? LOGISTICS_COLOR
          : FACTORY_COLOR;
    for (const side of [-1, 1]) {
      const x = centerX + side * 0.082;
      BUILDINGS.push({
        left: x - 0.059,
        right: x + 0.059,
        bottom: centerY - 0.115,
        top: centerY + 0.115,
        color,
        roadY: Y_STREETS[row],
      });
    }
  }
}

const PIPES = [];
for (const y of Y_STREETS) {
  for (let column = 0; column < COLUMNS; column++)
    PIPES.push([
      X_STREETS[column],
      y,
      X_STREETS[column + 1],
      y,
      MAIN_PIPE_COLOR,
    ]);
}
for (const x of X_STREETS) {
  for (let row = 0; row < ROWS; row++)
    PIPES.push([x, Y_STREETS[row], x, Y_STREETS[row + 1], MAIN_PIPE_COLOR]);
}
for (const building of BUILDINGS) {
  const x = (building.left + building.right) / 2;
  PIPES.push([x, building.roadY, x, building.bottom, BRANCH_PIPE_COLOR]);
}

function randomSource(seed) {
  let state = seed === 0 ? 0x9e3779b9 : seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function writeVertex(view, vertex, x, y, color, size) {
  const offset = HEADER_BYTES + vertex * STRIDE_FLOATS * 4;
  view.setFloat32(offset, x, true);
  view.setFloat32(offset + 4, y, true);
  view.setFloat32(offset + 8, color[0], true);
  view.setFloat32(offset + 12, color[1], true);
  view.setFloat32(offset + 16, color[2], true);
  view.setFloat32(offset + 20, color[3], true);
  view.setFloat32(offset + 24, size, true);
}

function createFrame(kind, sequence, featureCount, fill) {
  const vertexCount = featureCount * (kind === 1 ? 1 : kind === 2 ? 2 : 6);
  const byteLength = HEADER_BYTES + vertexCount * STRIDE_FLOATS * 4;
  if (byteLength > MAX_FRAME_BYTES)
    throw new Error("Generated frame exceeds the protocol limit");
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, kind, true);
  view.setUint32(8, byteLength, true);
  view.setUint32(12, featureCount, true);
  view.setUint32(16, vertexCount, true);
  view.setUint32(20, sequence, true);
  fill(view);
  return bytes;
}

function featureBatchLimit(batch, verticesPerFeature) {
  return Math.min(
    batch,
    Math.floor(
      (MAX_FRAME_BYTES - HEADER_BYTES) /
        (verticesPerFeature * STRIDE_FLOATS * 4),
    ),
  );
}

function writeEnergyCell(view, vertex, feature) {
  const building = BUILDINGS[feature % BUILDINGS.length];
  const cell = Math.floor(feature / BUILDINGS.length);
  // A fixed permutation spreads partial grids across the factory interior.
  const slot = (cell * 997) % 2500;
  const width = (building.right - building.left - 0.012) / 50;
  const height = (building.top - building.bottom - 0.012) / 50;
  const left = building.left + 0.006 + (slot % 50) * width;
  const bottom = building.bottom + 0.006 + Math.floor(slot / 50) * height;
  const right = left + width * 0.82;
  const top = bottom + height * 0.82;
  writeVertex(view, vertex, left, bottom, ENERGY_CELL_COLOR, 1);
  writeVertex(view, vertex + 1, right, bottom, ENERGY_CELL_COLOR, 1);
  writeVertex(view, vertex + 2, right, top, ENERGY_CELL_COLOR, 1);
  writeVertex(view, vertex + 3, left, bottom, ENERGY_CELL_COLOR, 1);
  writeVertex(view, vertex + 4, right, top, ENERGY_CELL_COLOR, 1);
  writeVertex(view, vertex + 5, left, top, ENERGY_CELL_COLOR, 1);
}

function microPipePosition(building, position) {
  if (position < 0)
    return [(building.left + building.right) / 2, building.bottom];
  const row = Math.floor(position / 71);
  const column = row % 2 === 0 ? position % 71 : 70 - (position % 71);
  return [
    building.left +
      0.005 +
      (column / 70) * (building.right - building.left - 0.01),
    building.bottom +
      0.005 +
      (row / 70) * (building.top - building.bottom - 0.01),
  ];
}

function writeMicroPipe(view, vertex, feature) {
  const building = BUILDINGS[feature % BUILDINGS.length];
  const segment = Math.floor(feature / BUILDINGS.length);
  const [x1, y1] = microPipePosition(building, segment - 1);
  const [x2, y2] = microPipePosition(building, segment);
  writeVertex(view, vertex, x1, y1, MICRO_PIPE_COLOR, 1);
  writeVertex(view, vertex + 1, x2, y2, MICRO_PIPE_COLOR, 1);
}

/** Repeatable local-plane industrial scene, with only one geometry frame allocated. */
export function* generateFrames({
  count,
  seed,
  batch,
  lines = 89,
  areas = 40,
}) {
  for (const [name, value] of Object.entries({
    count,
    seed,
    batch,
    lines,
    areas,
  })) {
    const [minimum, maximum] = GENERATION_LIMITS[name];
    if (!Number.isInteger(value) || value < minimum || value > maximum)
      throw new Error(`Invalid ${name}`);
  }
  const random = randomSource(seed);
  let sequence = 0;
  // Keep the original base frames byte-identical when the new options are omitted.
  const baseAreas = Math.min(areas, BUILDINGS.length);
  yield createFrame(3, sequence++, baseAreas, (view) => {
    BUILDINGS.slice(0, baseAreas).forEach((building, index) => {
      const { left, right, bottom, top, color } = building;
      const corners = [
        [left, bottom],
        [right, bottom],
        [right, top],
        [left, bottom],
        [right, top],
        [left, top],
      ];
      corners.forEach(([x, y], corner) =>
        writeVertex(view, index * 6 + corner, x, y, color, 1),
      );
    });
  });
  const areaBatch = featureBatchLimit(batch, 6);
  for (let emitted = baseAreas; emitted < areas; emitted += areaBatch) {
    const amount = Math.min(areaBatch, areas - emitted);
    yield createFrame(3, sequence++, amount, (view) => {
      for (let index = 0; index < amount; index++)
        writeEnergyCell(view, index * 6, emitted - BUILDINGS.length + index);
    });
  }
  const baseLines = Math.min(lines, PIPES.length);
  yield createFrame(2, sequence++, baseLines, (view) => {
    PIPES.slice(0, baseLines).forEach(([x1, y1, x2, y2, color], index) => {
      writeVertex(view, index * 2, x1, y1, color, 1);
      writeVertex(view, index * 2 + 1, x2, y2, color, 1);
    });
  });
  const lineBatch = featureBatchLimit(batch, 2);
  for (let emitted = baseLines; emitted < lines; emitted += lineBatch) {
    const amount = Math.min(lineBatch, lines - emitted);
    yield createFrame(2, sequence++, amount, (view) => {
      for (let index = 0; index < amount; index++)
        writeMicroPipe(view, index * 2, emitted - PIPES.length + index);
    });
  }
  for (let emitted = 0; emitted < count; emitted += batch) {
    const amount = Math.min(batch, count - emitted);
    yield createFrame(1, sequence++, amount, (view) => {
      for (let index = 0; index < amount; index++) {
        let x;
        let y;
        if (random() < 0.045) {
          // Sparse vehicles and road-side equipment share the regular street grid.
          if (random() < 0.5) {
            x = -0.92 + random() * 1.84;
            y =
              Y_STREETS[Math.floor(random() * Y_STREETS.length)] +
              (random() - 0.5) * 0.009;
          } else {
            x =
              X_STREETS[Math.floor(random() * X_STREETS.length)] +
              (random() - 0.5) * 0.009;
            y = -0.86 + random() * 1.72;
          }
        } else {
          const building = BUILDINGS[Math.floor(random() * BUILDINGS.length)];
          const spreadX = (random() + random()) / 2;
          const spreadY = (random() + random()) / 2;
          x =
            building.left +
            0.006 +
            spreadX * (building.right - building.left - 0.012);
          y =
            building.bottom +
            0.006 +
            spreadY * (building.top - building.bottom - 0.012);
        }
        const status = random();
        const color =
          status < 0.004
            ? ALERT_COLOR
            : status < 0.016
              ? WARNING_COLOR
              : DEVICE_COLORS[Math.floor(random() * DEVICE_COLORS.length)];
        const size =
          color === ALERT_COLOR
            ? 5.4
            : color === WARNING_COLOR
              ? 4.4
              : 2.1 + random() * 1.4;
        writeVertex(view, index, x, y, color, size);
      }
    });
  }
}
