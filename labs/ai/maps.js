// Arena layouts for the AI sandbox. Obstacles: { x, z, w, d, h }.
export function yardMap() {
  const o = [];
  const B = (x, z, w, d, h) => o.push({ x, z, w, d, h });
  // perimeter
  B(0, -20.5, 62, 1, 4); B(0, 20.5, 62, 1, 4); B(-30.5, 0, 1, 40, 4); B(30.5, 0, 1, 40, 4);
  // buildings (tall: block sight)
  B(-18, -10, 10, 8, 6); B(16, 10, 12, 7, 6); B(4, -13, 6, 5, 5);
  // walls with gaps
  B(-4, 4, 12, 0.4, 3); B(10, -3, 0.4, 9, 3);
  // shipping containers (tall)
  B(-20, 8, 6, 2.4, 2.6); B(-20, 12, 6, 2.4, 2.6); B(22, -8, 2.4, 6, 2.6);
  // low cover: crates, barriers (hide a crouching body, not a standing one)
  for (const [x, z, w, d] of [[-8, -4, 2, 1], [-2, -8, 1.2, 1.2], [6, 6, 2.4, 0.6], [0, 12, 1.2, 1.2], [14, 0, 1.2, 2.4], [-12, 2, 2.4, 0.6], [20, 2, 1.2, 1.2], [-25, -2, 1.2, 2.4], [2, -2, 1.2, 1.2], [-10, 14, 2.4, 0.6], [24, 14, 1.2, 1.2]]) B(x, z, w, d, 1.15);
  return {
    width: 60, depth: 40, obstacles: o,
    spawns: [[18, -14], [24, 4], [-6, 16], [-24, -16]],
    patrol: [[18, -14], [26, -2], [24, 6], [6, 16], [-6, 16], [-14, 8], [-24, -16], [-8, -16], [0, 0]],
    playerSpawn: [-26, 16],
  };
}
