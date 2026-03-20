import {
  PoseLandmarker,
  FilesetResolver,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs';

let poseLandmarker = null;
let videoElement = null;
let lastTimestamp = -1;

// Landmark indices
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_ELBOW = 13;
const RIGHT_ELBOW = 14;
const LEFT_PINKY = 17;
const RIGHT_PINKY = 18;
const LEFT_INDEX = 19;
const RIGHT_INDEX = 20;
const LEFT_THUMB = 21;
const RIGHT_THUMB = 22;
const LEFT_ANKLE = 27;
const RIGHT_ANKLE = 28;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;
const LEFT_KNEE = 25;
const RIGHT_KNEE = 26;

// Position buffers (5 frames)
const BUFFER_SIZE = 5;
const VELOCITY_FRAME_GAP = 3;
const buffers = {
  leftFist: [],
  rightFist: [],
  leftAnkle: [],
  rightAnkle: [],
};

// Cooldowns (in frames)
const PUNCH_COOLDOWN = 15;
const KICK_COOLDOWN = 20;
let leftPunchCD = 0;
let rightPunchCD = 0;
let leftKickCD = 0;
let rightKickCD = 0;

// Thresholds
const PUNCH_VELOCITY_THRESHOLD = 0.017;
const PUNCH_LATERAL_THRESHOLD = 0.010;
const PUNCH_FORWARD_THRESHOLD = 0.008;
const PUNCH_Z_WEIGHT = 1.45;
const KICK_VELOCITY_THRESHOLD = 0.024;
const ARM_EXTENSION_RATIO = 0.62;
const FORWARD_EXTENSION_BONUS = 0.06;
const LEG_EXTENSION_RATIO = 0.70;
const FIST_REACH_MIN_RATIO = 0.18;
const FIST_REACH_MAX_RATIO = 0.32;
const FOREARM_DIRECTION_BLEND = 0.35;
const KICK_REACH_EXTENSION = 0.22;

// Baseline ankle Y (calibrated at start)
let ankleBaseline = null;
const ANKLE_RISE_THRESHOLD = 0.06;

// Pose state output
const poseState = {
  landmarks: null,
  fists: { left: null, right: null },
  punches: [],   // { side: 'left'|'right', x, y, velocity }
  kicks: [],     // { side: 'left'|'right', x, y, velocity }
};

export async function initPose(video) {
  videoElement = video;
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
  );
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
}

function dist2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function dist3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function limbLength2D(landmarks, joint1, joint2, joint3) {
  return dist2D(landmarks[joint1], landmarks[joint2]) +
         dist2D(landmarks[joint2], landmarks[joint3]);
}

function endToEndDist2D(landmarks, joint1, joint3) {
  return dist2D(landmarks[joint1], landmarks[joint3]);
}

function extendPoint(a, b, amount) {
  return {
    x: b.x + (b.x - a.x) * amount,
    y: b.y + (b.y - a.y) * amount,
    z: (b.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * amount,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize2D(point) {
  const length = Math.sqrt(point.x * point.x + point.y * point.y);
  if (length === 0) return null;
  return {
    x: point.x / length,
    y: point.y / length,
  };
}

function normalize3D(point) {
  const length = Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z);
  if (length === 0) return null;
  return {
    x: point.x / length,
    y: point.y / length,
    z: point.z / length,
  };
}

function getFistCenter(landmarks, wrist, elbow, indexFinger, pinky, thumb) {
  const wristPoint = landmarks[wrist];
  const handAnchor = {
    x: (landmarks[indexFinger].x + landmarks[pinky].x + landmarks[thumb].x) / 3,
    y: (landmarks[indexFinger].y + landmarks[pinky].y + landmarks[thumb].y) / 3,
    z: ((landmarks[indexFinger].z ?? 0) + (landmarks[pinky].z ?? 0) + (landmarks[thumb].z ?? 0)) / 3,
  };
  const handDir2D = normalize2D({
    x: handAnchor.x - wristPoint.x,
    y: handAnchor.y - wristPoint.y,
  });
  const forearmDir2D = normalize2D({
    x: wristPoint.x - landmarks[elbow].x,
    y: wristPoint.y - landmarks[elbow].y,
  });
  const handDir3D = normalize3D({
    x: handAnchor.x - wristPoint.x,
    y: handAnchor.y - wristPoint.y,
    z: handAnchor.z - (wristPoint.z ?? 0),
  });
  const forearmDir3D = normalize3D({
    x: wristPoint.x - landmarks[elbow].x,
    y: wristPoint.y - landmarks[elbow].y,
    z: (wristPoint.z ?? 0) - (landmarks[elbow].z ?? 0),
  });
  const blendedDir3D = normalize3D({
    x: (handDir3D?.x ?? handDir2D?.x ?? 0) + (forearmDir3D?.x ?? forearmDir2D?.x ?? 0) * FOREARM_DIRECTION_BLEND,
    y: (handDir3D?.y ?? handDir2D?.y ?? 0) + (forearmDir3D?.y ?? forearmDir2D?.y ?? 0) * FOREARM_DIRECTION_BLEND,
    z: (handDir3D?.z ?? 0) + (forearmDir3D?.z ?? 0) * FOREARM_DIRECTION_BLEND,
  }) || forearmDir3D || handDir3D;
  const blendedDir2D = normalize2D({
    x: blendedDir3D?.x ?? handDir2D?.x ?? forearmDir2D?.x ?? 0,
    y: blendedDir3D?.y ?? handDir2D?.y ?? forearmDir2D?.y ?? 0,
  }) || forearmDir2D || handDir2D;

  if (!blendedDir2D) {
    return { x: wristPoint.x, y: wristPoint.y, z: wristPoint.z ?? 0 };
  }

  const reach = clamp(
    dist2D(wristPoint, handAnchor) * 1.8,
    dist2D(landmarks[elbow], wristPoint) * FIST_REACH_MIN_RATIO,
    dist2D(landmarks[elbow], wristPoint) * FIST_REACH_MAX_RATIO
  );

  return {
    x: wristPoint.x + blendedDir2D.x * reach,
    y: wristPoint.y + blendedDir2D.y * reach,
    z: (wristPoint.z ?? 0) + (blendedDir3D?.z ?? 0) * reach,
  };
}

function limbLengthToPoint3D(landmarks, joint1, joint2, point) {
  return dist3D(landmarks[joint1], landmarks[joint2]) +
         dist3D(landmarks[joint2], point);
}

function endToEndDistToPoint3D(landmarks, joint1, point) {
  return dist3D(landmarks[joint1], point);
}

function pushBuffer(buf, pos) {
  buf.push({ x: pos.x, y: pos.y, z: pos.z ?? 0 });
  if (buf.length > BUFFER_SIZE) buf.shift();
}

function getVelocity(buf, zWeight = 0) {
  if (buf.length < VELOCITY_FRAME_GAP + 1) return 0;
  const curr = buf[buf.length - 1];
  const prev = buf[buf.length - 1 - VELOCITY_FRAME_GAP];
  const dx = curr.x - prev.x;
  const dy = curr.y - prev.y;
  const dz = (curr.z - prev.z) * zWeight;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function getPunchMotion(buf) {
  if (buf.length < VELOCITY_FRAME_GAP + 1) {
    return { speed: 0, lateral: 0, forward: 0 };
  }
  const curr = buf[buf.length - 1];
  const prev = buf[buf.length - 1 - VELOCITY_FRAME_GAP];
  const dx = curr.x - prev.x;
  const dy = curr.y - prev.y;
  const dz = curr.z - prev.z;
  const lateral = Math.sqrt(dx * dx + dy * dy);
  return {
    speed: Math.sqrt(dx * dx + dy * dy + (dz * PUNCH_Z_WEIGHT) * (dz * PUNCH_Z_WEIGHT)),
    lateral,
    forward: Math.max(0, prev.z - curr.z),
  };
}

export function detectPose(timestamp) {
  if (!poseLandmarker || !videoElement || videoElement.readyState < 2) return;

  // MediaPipe requires strictly increasing timestamps
  const ts = Math.round(timestamp);
  if (ts <= lastTimestamp) return;
  lastTimestamp = ts;

  const result = poseLandmarker.detectForVideo(videoElement, ts);

  poseState.punches = [];
  poseState.kicks = [];

  if (!result.landmarks || result.landmarks.length === 0) {
    poseState.landmarks = null;
    poseState.fists.left = null;
    poseState.fists.right = null;
    return;
  }

  const lm = result.landmarks[0];
  poseState.landmarks = lm;
  poseState.fists.left = getFistCenter(lm, LEFT_WRIST, LEFT_ELBOW, LEFT_INDEX, LEFT_PINKY, LEFT_THUMB);
  poseState.fists.right = getFistCenter(lm, RIGHT_WRIST, RIGHT_ELBOW, RIGHT_INDEX, RIGHT_PINKY, RIGHT_THUMB);
  const leftFoot = extendPoint(lm[LEFT_KNEE], lm[LEFT_ANKLE], KICK_REACH_EXTENSION);
  const rightFoot = extendPoint(lm[RIGHT_KNEE], lm[RIGHT_ANKLE], KICK_REACH_EXTENSION);

  // Update buffers
  pushBuffer(buffers.leftFist, poseState.fists.left);
  pushBuffer(buffers.rightFist, poseState.fists.right);
  pushBuffer(buffers.leftAnkle, leftFoot);
  pushBuffer(buffers.rightAnkle, rightFoot);

  // Calibrate ankle baseline
  if (ankleBaseline === null) {
    ankleBaseline = (lm[LEFT_ANKLE].y + lm[RIGHT_ANKLE].y) / 2;
  } else {
    // Slowly adapt baseline
    const currentBaseline = (lm[LEFT_ANKLE].y + lm[RIGHT_ANKLE].y) / 2;
    ankleBaseline = ankleBaseline * 0.98 + currentBaseline * 0.02;
  }

  // Decrement cooldowns
  if (leftPunchCD > 0) leftPunchCD--;
  if (rightPunchCD > 0) rightPunchCD--;
  if (leftKickCD > 0) leftKickCD--;
  if (rightKickCD > 0) rightKickCD--;

  detectPunch(lm, 'left', LEFT_ELBOW, LEFT_SHOULDER, buffers.leftFist, poseState.fists.left);
  detectPunch(lm, 'right', RIGHT_ELBOW, RIGHT_SHOULDER, buffers.rightFist, poseState.fists.right);

  // Detect kicks
  detectKick(lm, 'left', LEFT_ANKLE, LEFT_KNEE, LEFT_HIP, buffers.leftAnkle, leftFoot);
  detectKick(lm, 'right', RIGHT_ANKLE, RIGHT_KNEE, RIGHT_HIP, buffers.rightAnkle, rightFoot);
}

function detectPunch(lm, side, elbow, shoulder, buffer, fist) {
  const cd = side === 'left' ? leftPunchCD : rightPunchCD;
  if (cd > 0) return;

  const motion = getPunchMotion(buffer);
  if (motion.speed < PUNCH_VELOCITY_THRESHOLD) return;
  if (motion.lateral < PUNCH_LATERAL_THRESHOLD && motion.forward < PUNCH_FORWARD_THRESHOLD) return;

  const totalLen = limbLengthToPoint3D(lm, shoulder, elbow, fist);
  const directLen = endToEndDistToPoint3D(lm, shoulder, fist);
  const extension = totalLen > 0 ? directLen / totalLen : 0;
  const requiredExtension = Math.max(
    0,
    ARM_EXTENSION_RATIO - (motion.forward >= PUNCH_FORWARD_THRESHOLD ? FORWARD_EXTENSION_BONUS : 0)
  );
  if (extension < requiredExtension) return;

  poseState.punches.push({
    side,
    x: fist.x,
    y: fist.y,
    velocity: motion.speed,
  });

  if (side === 'left') leftPunchCD = PUNCH_COOLDOWN;
  else rightPunchCD = PUNCH_COOLDOWN;
}

function detectKick(lm, side, ankle, knee, hip, buffer, footPoint) {
  const cd = side === 'left' ? leftKickCD : rightKickCD;
  if (cd > 0) return;

  const velocity = getVelocity(buffer);
  if (velocity < KICK_VELOCITY_THRESHOLD) return;

  const totalLen = limbLength2D(lm, hip, knee, ankle);
  const directLen = endToEndDist2D(lm, hip, ankle);
  const extension = totalLen > 0 ? directLen / totalLen : 0;
  if (extension < LEG_EXTENSION_RATIO) return;

  // Check ankle has risen above baseline
  const ankleY = lm[ankle].y;
  if (ankleBaseline !== null && (ankleBaseline - ankleY) < ANKLE_RISE_THRESHOLD) return;

  poseState.kicks.push({
    side,
    x: footPoint.x,
    y: footPoint.y,
    velocity,
  });

  if (side === 'left') leftKickCD = KICK_COOLDOWN;
  else rightKickCD = KICK_COOLDOWN;
}

export function getPoseState() {
  return poseState;
}
