import * as THREE from 'three';
import type { Checkpoint, Shop } from './NanningChainBridge';

/**
 * 在 3D 城市里画出链上任务打卡点（发光圆环 + 光柱）和商家入口标记。
 * 坐标与 public/data/nanning.json 一致（x 向东、z 向南，单位米），无需任何换算。
 */
export class CheckpointMarkers {
  readonly group = new THREE.Group();
  private rings: THREE.Mesh[] = [];

  constructor(checkpoints: Checkpoint[], shops: Shop[]) {
    for (const cp of checkpoints) {
      const color = cp.kind === 'metro' ? 0x22d3ee : 0xfacc15;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(cp.radius - 2.5, cp.radius, 64),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(cp.x, 0.35, cp.z);
      this.rings.push(ring);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(1.2, 1.2, 60, 12, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      beam.position.set(cp.x, 30, cp.z);
      this.group.add(ring, beam);
    }
    for (const s of shops) {
      const pin = new THREE.Mesh(
        new THREE.OctahedronGeometry(4),
        new THREE.MeshBasicMaterial({ color: s.kind === 'scenic' ? 0x34d399 : s.kind === 'event' ? 0x38bdf8 : 0xf472b6 }),
      );
      pin.position.set(s.x, 18, s.z);
      pin.userData.spin = true;
      this.group.add(pin);
    }
  }

  update(time: number): void {
    const pulse = 1 + 0.06 * Math.sin(time * 3);
    for (const r of this.rings) r.scale.setScalar(pulse);
    for (const o of this.group.children) if (o.userData.spin) o.rotation.y = time * 1.5;
  }
}
