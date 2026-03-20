import {
  PoseLandmarker,
  FilesetResolver,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs';

let poseLandmarker = null;
let videoElement = null;
let lastTimestamp = -1;
let currentLandmarks = null;

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
  leftWrist: [],
  rightWrist: [],
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
const PUNCH_VELOCITY_THRESHOLD = 0.025;
const KICK_VELOCITY_THRESHOLD = 0.020;
const ARM_EXTENSION_RATIO = 0.75;
const LEG_EXTENSION_RATIO = 0.70;

// Baseline ankle Y (calibrated at start)
let ankleBaseline = null;
const ANKLE_RISE_THRESHOLD = 0.05;

// Pose state output
const poseState = {
  landmarks: null,
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
    currentLandmarks = null;
    return;
  }

  const lm = result.landmarks[0];
  currentLandmarks = lm;
  poseState.landmarks = lm;

  // Update buffers
  pushBuffer(buffers.leftWrist, lm[LEFT_WRIST]);
  pushBuffer(buffers.rightWrist, lm[RIGHT_WRIST]);
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

  // Detect punches (fist position = midpoint of index + pinky fingers)
  detectPunch(lm, 'left', LEFT_WRIST, LEFT_ELBOW, LEFT_SHOULDER, buffers.leftWrist, LEFT_INDEX, LEFT_PINKY);
  detectPunch(lm, 'right', RIGHT_WRIST, RIGHT_ELBOW, RIGHT_SHOULDER, buffers.rightWrist, RIGHT_INDEX, RIGHT_PINKY);

  // Detect kicks
  detectKick(lm, 'left', LEFT_ANKLE, LEFT_KNEE, LEFT_HIP, buffers.leftAnkle);
  detectKick(lm, 'right', RIGHT_ANKLE, RIGHT_KNEE, RIGHT_HIP, buffers.rightAnkle);
}

function detectPunch(lm, side, wrist, elbow, shoulder, buffer, indexFinger, pinky) {
  const cd = side === 'left' ? leftPunchCD : rightPunchCD;
  if (cd > 0) return;

  const velocity = getVelocity(buffer);
  if (velocity < PUNCH_VELOCITY_THRESHOLD) return;

  const totalLen = limbLength(lm, shoulder, elbow, wrist);
  const directLen = endToEndDist(lm, shoulder, wrist);
  const extension = totalLen > 0 ? directLen / totalLen : 0;
  if (extension < ARM_EXTENSION_RATIO) return;

  // Fist center = midpoint of index finger and pinky knuckle
  const fistX = (lm[indexFinger].x + lm[pinky].x) / 2;
  const fistY = (lm[indexFinger].y + lm[pinky].y) / 2;

  poseState.punches.push({
    side,
    x: fistX,
    y: fistY,
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
