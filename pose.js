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
const PUNCH_VELOCITY_THRESHOLD = 0.020;
const KICK_VELOCITY_THRESHOLD = 0.020;
const ARM_EXTENSION_RATIO = 0.68;
const LEG_EXTENSION_RATIO = 0.70;
const FIST_REACH_MIN_RATIO = 0.18;
const FIST_REACH_MAX_RATIO = 0.32;
const FOREARM_DIRECTION_BLEND = 0.35;

// Baseline ankle Y (calibrated at start)
let ankleBaseline = null;
const ANKLE_RISE_THRESHOLD = 0.05;

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

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function limbLength(landmarks, joint1, joint2, joint3) {
  return dist(landmarks[joint1], landmarks[joint2]) +
         dist(landmarks[joint2], landmarks[joint3]);
}

function endToEndDist(landmarks, joint1, joint3) {
  return dist(landmarks[joint1], landmarks[joint3]);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize(point) {
  const length = Math.sqrt(point.x * point.x + point.y * point.y);
  if (length === 0) return null;
  return {
    x: point.x / length,
    y: point.y / length,
  };
}

function getFistCenter(landmarks, wrist, elbow, indexFinger, pinky, thumb) {
  const wristPoint = landmarks[wrist];
  const handAnchor = {
    x: (landmarks[indexFinger].x + landmarks[pinky].x + landmarks[thumb].x) / 3,
    y: (landmarks[indexFinger].y + landmarks[pinky].y + landmarks[thumb].y) / 3,
  };
  const handDir = normalize({
    x: handAnchor.x - wristPoint.x,
    y: handAnchor.y - wristPoint.y,
  });
  const forearmDir = normalize({
    x: wristPoint.x - landmarks[elbow].x,
    y: wristPoint.y - landmarks[elbow].y,
  });
  const blendedDir = normalize({
    x: (handDir?.x ?? 0) + (forearmDir?.x ?? 0) * FOREARM_DIRECTION_BLEND,
    y: (handDir?.y ?? 0) + (forearmDir?.y ?? 0) * FOREARM_DIRECTION_BLEND,
  }) || forearmDir || handDir;

  if (!blendedDir) {
    return { x: wristPoint.x, y: wristPoint.y };
  }

  const reach = clamp(
    dist(wristPoint, handAnchor) * 1.8,
    dist(landmarks[elbow], wristPoint) * FIST_REACH_MIN_RATIO,
    dist(landmarks[elbow], wristPoint) * FIST_REACH_MAX_RATIO
  );

  return {
    x: wristPoint.x + blendedDir.x * reach,
    y: wristPoint.y + blendedDir.y * reach,
  };
}

function limbLengthToPoint(landmarks, joint1, joint2, point) {
  return dist(landmarks[joint1], landmarks[joint2]) +
         dist(landmarks[joint2], point);
}

function endToEndDistToPoint(landmarks, joint1, point) {
  return dist(landmarks[joint1], point);
}

function pushBuffer(buf, pos) {
  buf.push({ x: pos.x, y: pos.y });
  if (buf.length > BUFFER_SIZE) buf.shift();
}

function getVelocity(buf) {
  if (buf.length < VELOCITY_FRAME_GAP + 1) return 0;
  const curr = buf[buf.length - 1];
  const prev = buf[buf.length - 1 - VELOCITY_FRAME_GAP];
  const dx = curr.x - prev.x;
  const dy = curr.y - prev.y;
  return Math.sqrt(dx * dx + dy * dy);
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

  // Update buffers
  pushBuffer(buffers.leftFist, poseState.fists.left);
  pushBuffer(buffers.rightFist, poseState.fists.right);
  pushBuffer(buffers.leftAnkle, lm[LEFT_ANKLE]);
  pushBuffer(buffers.rightAnkle, lm[RIGHT_ANKLE]);

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
  detectKick(lm, 'left', LEFT_ANKLE, LEFT_KNEE, LEFT_HIP, buffers.leftAnkle);
  detectKick(lm, 'right', RIGHT_ANKLE, RIGHT_KNEE, RIGHT_HIP, buffers.rightAnkle);
}

function detectPunch(lm, side, elbow, shoulder, buffer, fist) {
  const cd = side === 'left' ? leftPunchCD : rightPunchCD;
  if (cd > 0) return;

  const velocity = getVelocity(buffer);
  if (velocity < PUNCH_VELOCITY_THRESHOLD) return;

  const totalLen = limbLengthToPoint(lm, shoulder, elbow, fist);
  const directLen = endToEndDistToPoint(lm, shoulder, fist);
  const extension = totalLen > 0 ? directLen / totalLen : 0;
  if (extension < ARM_EXTENSION_RATIO) return;

  poseState.punches.push({
    side,
    x: fist.x,
    y: fist.y,
    velocity,
  });

  if (side === 'left') leftPunchCD = PUNCH_COOLDOWN;
  else rightPunchCD = PUNCH_COOLDOWN;
}

function detectKick(lm, side, ankle, knee, hip, buffer) {
  const cd = side === 'left' ? leftKickCD : rightKickCD;
  if (cd > 0) return;

  const velocity = getVelocity(buffer);
  if (velocity < KICK_VELOCITY_THRESHOLD) return;

  const totalLen = limbLength(lm, hip, knee, ankle);
  const directLen = endToEndDist(lm, hip, ankle);
  const extension = totalLen > 0 ? directLen / totalLen : 0;
  if (extension < LEG_EXTENSION_RATIO) return;

  // Check ankle has risen above baseline
  const ankleY = lm[ankle].y;
  if (ankleBaseline !== null && (ankleBaseline - ankleY) < ANKLE_RISE_THRESHOLD) return;

  poseState.kicks.push({
    side,
    x: lm[ankle].x,
    y: lm[ankle].y,
    velocity,
  });

  if (side === 'left') leftKickCD = KICK_COOLDOWN;
  else rightKickCD = KICK_COOLDOWN;
}

export function getPoseState() {
  return poseState;
}
