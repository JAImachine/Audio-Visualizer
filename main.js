const canvas = document.querySelector("#visualizer");
const ctx = canvas.getContext("2d", { alpha: false });
const micButton = document.querySelector("#micButton");

const POINT_COUNT = 128;
const visualSettings = {
  boost: 10,
  ease: 0.7,
  amplitude: 1,
  period: 1,
};

function createMotionPoints() {
  return Array.from({ length: POINT_COUNT }, (_, index) => ({
    progress: index / (POINT_COUNT - 1),
    targetY: 0,
    y: 0,
    velocity: 0,
  }));
}

const bands = {
  low: {
    level: 0,
    target: 0,
    color: "#31D6A0",
    amplitude: 24,
    period: 1.9,
    width: 8,
    range: [35, 220],
    normalize: [12, 132],
    easing: [0.12, 0.32, 5.4],
    filter: { type: "lowpass", frequency: 220, q: 0.72 },
    tension: 0.085,
    friction: 0.86,
    sampleRadius: 8,
    sampleAdvance: 0.34,
    points: createMotionPoints(),
    sampleCursor: 0,
  },
  mid: {
    level: 0,
    target: 0,
    color: "#4DA3FF",
    amplitude: 50,
    period: 1,
    width: 8,
    range: [220, 2200],
    normalize: [10, 118],
    easing: [0.1, 0.26, 6.2],
    filter: { type: "bandpass", frequency: 930, q: 0.86 },
    tension: 0.12,
    friction: 0.8,
    sampleRadius: 4,
    sampleAdvance: 0.82,
    points: createMotionPoints(),
    sampleCursor: 0,
  },
  high: {
    level: 0,
    target: 0,
    color: "#FF6F91",
    amplitude: 88,
    period: 0.55,
    width: 8,
    range: [2200, 9500],
    normalize: [8, 96],
    easing: [0.08, 0.2, 7.4],
    filter: { type: "highpass", frequency: 2200, q: 0.68 },
    tension: 0.18,
    friction: 0.74,
    sampleRadius: 1,
    sampleAdvance: 1.7,
    points: createMotionPoints(),
    sampleCursor: 0,
  },
};

const colorControls = {
  low: {
    picker: document.querySelector("#lowPicker"),
    hex: document.querySelector("#lowHex"),
  },
  mid: {
    picker: document.querySelector("#midPicker"),
    hex: document.querySelector("#midHex"),
  },
  high: {
    picker: document.querySelector("#highPicker"),
    hex: document.querySelector("#highHex"),
  },
};

const widthControls = {
  low: {
    input: document.querySelector("#lowWidth"),
  },
  mid: {
    input: document.querySelector("#midWidth"),
  },
  high: {
    input: document.querySelector("#highWidth"),
  },
};

const globalControls = {
  boost: {
    input: document.querySelector("#boostScale"),
  },
  ease: {
    input: document.querySelector("#easeScale"),
  },
  amplitude: {
    input: document.querySelector("#amplitudeScale"),
  },
  period: {
    input: document.querySelector("#periodScale"),
  },
};

let audioContext;
let audioSource;
let animationId;
let stream;
let isListening = false;
let lastFrameAt = performance.now();

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function normalize(value, floor, ceiling) {
  return Math.max(0, Math.min(1, (value - floor) / (ceiling - floor)));
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function easeLevel(current, target, deltaSeconds, attack, release, maxDelta) {
  const duration = target > current ? attack : release;
  const amount = easeOutCubic(Math.min(1, deltaSeconds / duration));
  const next = current + (target - current) * amount;
  const limit = maxDelta * deltaSeconds;
  const change = Math.max(-limit, Math.min(limit, next - current));

  return current + change;
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

function formatHex(value) {
  const trimmed = value.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;

  return withHash.toUpperCase();
}

function setBandColor(name, value) {
  const nextColor = formatHex(value);
  const controls = colorControls[name];

  if (!isHexColor(nextColor)) {
    controls.hex.classList.add("is-invalid");
    return;
  }

  bands[name].color = nextColor;
  controls.hex.classList.remove("is-invalid");
  controls.hex.value = nextColor;
  controls.picker.value = nextColor;
}

function setupColorControls() {
  Object.entries(colorControls).forEach(([name, controls]) => {
    controls.picker.value = bands[name].color;
    controls.hex.value = bands[name].color;

    controls.picker.addEventListener("input", () => {
      setBandColor(name, controls.picker.value);
    });

    controls.hex.addEventListener("input", () => {
      const nextColor = formatHex(controls.hex.value);
      if (isHexColor(nextColor)) {
        setBandColor(name, nextColor);
      } else {
        controls.hex.classList.add("is-invalid");
      }
    });

    controls.hex.addEventListener("blur", () => {
      if (!isHexColor(formatHex(controls.hex.value))) {
        controls.hex.value = bands[name].color;
        controls.hex.classList.remove("is-invalid");
      }
    });
  });
}

function setupWidthControls() {
  Object.entries(widthControls).forEach(([name, controls]) => {
    controls.input.value = bands[name].width;

    controls.input.addEventListener("input", () => {
      const nextWidth = Math.max(0, Math.min(999, Number(controls.input.value) || 0));
      bands[name].width = nextWidth;
    });
  });
}

function formatSliderValue(value) {
  return Number(value).toFixed(1).replace(/\.0$/, "");
}

function setupGlobalControls() {
  Object.entries(globalControls).forEach(([name, controls]) => {
    controls.input.value = formatSliderValue(visualSettings[name]);

    controls.input.addEventListener("input", () => {
      const nextValue = Math.max(0, Math.min(999, Number(controls.input.value) || 0));
      visualSettings[name] = nextValue;
    });
  });
}

function getLineBounds() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const leftUiSpace = width > 720 ? 288 : 32;

  return {
    startX: leftUiSpace,
    endX: width - 48,
    startY: height * 0.52,
    endY: height * 0.52,
  };
}

function createBandAudioGraph(name, source) {
  const band = bands[name];
  const filter = audioContext.createBiquadFilter();
  const analyser = audioContext.createAnalyser();

  filter.type = band.filter.type;
  filter.frequency.value = band.filter.frequency;
  filter.Q.value = band.filter.q;

  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.48;

  source.connect(filter);
  filter.connect(analyser);

  band.analyser = analyser;
  band.frequencyData = new Uint8Array(analyser.frequencyBinCount);
  band.timeData = new Uint8Array(analyser.fftSize);
}

function averageFrequencyRange(band) {
  const nyquist = audioContext.sampleRate / 2;
  const [fromHz, toHz] = band.range;
  const start = Math.floor((fromHz / nyquist) * band.frequencyData.length);
  const end = Math.max(start + 1, Math.floor((toHz / nyquist) * band.frequencyData.length));
  let total = 0;

  for (let i = start; i < end; i += 1) {
    total += band.frequencyData[i];
  }

  return total / (end - start);
}

function spectrumAtProgress(band, progress) {
  if (!band.frequencyData) {
    return 0;
  }

  const nyquist = audioContext.sampleRate / 2;
  const [fromHz, toHz] = band.range;
  const minLog = Math.log(fromHz);
  const maxLog = Math.log(toHz);
  const hz = Math.exp(minLog + (maxLog - minLog) * progress);
  const center = Math.floor((hz / nyquist) * band.frequencyData.length);
  const radius = band.sampleRadius + 1;
  let total = 0;
  let count = 0;

  for (let offset = -radius; offset <= radius; offset += 1) {
    const index = Math.max(0, Math.min(band.frequencyData.length - 1, center + offset));
    total += band.frequencyData[index];
    count += 1;
  }

  return total / count / 255;
}

function waveformAtProgress(band, progress) {
  if (!band.timeData) {
    return 0;
  }

  const period = Math.max(0.1, visualSettings.period * band.period);
  const periodProgress = 0.5 + (progress - 0.5) / period;
  const clampedProgress = Math.max(0, Math.min(1, periodProgress));
  const center = Math.floor((clampedProgress * (band.timeData.length - 1) + band.sampleCursor) % band.timeData.length);
  let total = 0;
  let count = 0;

  for (let offset = -band.sampleRadius; offset <= band.sampleRadius; offset += 1) {
    const index = (center + offset + band.timeData.length) % band.timeData.length;
    total += (band.timeData[index] - 128) / 128;
    count += 1;
  }

  const sample = total / count;
  return Math.sign(sample) * Math.pow(Math.abs(sample), 0.72);
}

function updateBandFromAudio(band, deltaSeconds) {
  band.analyser.getByteFrequencyData(band.frequencyData);
  band.analyser.getByteTimeDomainData(band.timeData);

  const [floor, ceiling] = band.normalize;
  const [attack, release, maxDelta] = band.easing;
  band.target = normalize(averageFrequencyRange(band), floor, ceiling);
  band.level = easeLevel(band.level, band.target, deltaSeconds, attack, release, maxDelta);
  band.sampleCursor = (band.sampleCursor + band.sampleAdvance * (0.18 + band.level * 1.6)) % band.timeData.length;

  const frameScale = deltaSeconds * 60;
  const easeRetention = Math.max(0, Math.min(0.97, visualSettings.ease));
  const targetEase = 1 - Math.pow(easeRetention, frameScale);
  const velocityDamping = Math.pow(1 - visualSettings.ease * 0.16, frameScale);
  const maxDisplacement = canvas.clientHeight * 0.44;
  const targets = [];
  let weightedTargetTotal = 0;
  let envelopeTotal = 0;

  band.points.forEach((point) => {
    const envelope = Math.sin(Math.PI * point.progress);
    const wave = waveformAtProgress(band, point.progress);
    const spectrum = spectrumAtProgress(band, point.progress);
    const energy = 0.24 + spectrum * 1.85 + band.level * 1.35;
    const rawTarget = wave * band.amplitude * visualSettings.amplitude * visualSettings.boost * energy * envelope;
    const target = Math.tanh(rawTarget / maxDisplacement) * maxDisplacement;

    targets.push({ envelope, target });
    weightedTargetTotal += target * envelope;
    envelopeTotal += envelope;
  });

  const centerOffset = envelopeTotal > 0 ? weightedTargetTotal / envelopeTotal : 0;

  band.points.forEach((point, index) => {
    const { envelope, target } = targets[index];
    const centeredTarget = target - centerOffset * envelope;

    point.targetY += (centeredTarget - point.targetY) * targetEase;
    point.velocity += (point.targetY - point.y) * band.tension * frameScale;
    point.velocity *= Math.pow(band.friction, frameScale);
    point.velocity *= velocityDamping;
    point.y += point.velocity * frameScale;
  });

  const centerDrift = band.points.reduce((total, point) => total + point.y, 0) / band.points.length;
  band.points.forEach((point) => {
    const envelope = Math.sin(Math.PI * point.progress);
    point.y -= centerDrift * envelope * 0.65;
  });

  band.points[0].targetY = 0;
  band.points[0].y = 0;
  band.points[band.points.length - 1].targetY = 0;
  band.points[band.points.length - 1].y = 0;
}

function relaxBand(band) {
  band.points.forEach((point) => {
    point.targetY *= 0.82;
    point.velocity *= 0.72;
    point.y *= 0.82;
  });
}

function getAreaPoint(band, index) {
  const { startX, endX, startY, endY } = getLineBounds();
  const point = band.points[index];
  const x = startX + (endX - startX) * point.progress;
  const baselineY = startY + (endY - startY) * point.progress;
  const magnitude = Math.max(Math.abs(point.y), band.width * 0.5);

  return {
    x,
    upperY: baselineY - magnitude,
    lowerY: baselineY + magnitude,
  };
}

function traceWaveArea(band) {
  const points = band.points;
  const first = getAreaPoint(band, 0);

  ctx.beginPath();
  ctx.moveTo(first.x, first.upperY);

  for (let i = 1; i < points.length - 1; i += 1) {
    const point = getAreaPoint(band, i);
    const next = getAreaPoint(band, i + 1);
    const midX = (point.x + next.x) / 2;
    const midY = (point.upperY + next.upperY) / 2;

    ctx.quadraticCurveTo(point.x, point.upperY, midX, midY);
  }

  const last = getAreaPoint(band, points.length - 1);
  ctx.lineTo(last.x, last.lowerY);

  for (let i = points.length - 2; i > 0; i -= 1) {
    const point = getAreaPoint(band, i);
    const previous = getAreaPoint(band, i - 1);
    const midX = (point.x + previous.x) / 2;
    const midY = (point.lowerY + previous.lowerY) / 2;

    ctx.quadraticCurveTo(point.x, point.lowerY, midX, midY);
  }

  ctx.closePath();
}

function drawWaveArea(band, blendMode, alpha = 1) {
  ctx.save();
  ctx.globalCompositeOperation = blendMode;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = band.color;
  traceWaveArea(band);
  ctx.fill();
  ctx.restore();
}

function drawFrame() {
  if (!isListening) {
    Object.values(bands).forEach(relaxBand);
  }

  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#050608";
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  Object.values(bands).forEach((band) => {
    drawWaveArea(band, "source-over", 0.86);
  });

  Object.values(bands).forEach((band) => {
    drawWaveArea(band, "overlay", 0.9);
  });

  animationId = requestAnimationFrame(isListening ? render : drawFrame);
}

function render() {
  const now = performance.now();
  const deltaSeconds = Math.min(0.05, (now - lastFrameAt) / 1000);
  lastFrameAt = now;

  Object.values(bands).forEach((band) => {
    updateBandFromAudio(band, deltaSeconds);
  });

  drawFrame();
}

async function startMic() {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  audioContext = new AudioContext();
  audioSource = audioContext.createMediaStreamSource(stream);

  Object.keys(bands).forEach((name) => {
    createBandAudioGraph(name, audioSource);
  });

  await audioContext.resume();

  isListening = true;
  lastFrameAt = performance.now();
  micButton.textContent = "마이크 중지";
  micButton.classList.add("is-listening");
  cancelAnimationFrame(animationId);
  render();
}

function resetBandMotion() {
  Object.values(bands).forEach((band) => {
    band.level = 0;
    band.target = 0;
    band.sampleCursor = 0;
    band.points.forEach((point) => {
      point.targetY = 0;
      point.y = 0;
      point.velocity = 0;
    });
  });
}

function stopMic() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }

  if (audioContext) {
    audioContext.close();
  }

  stream = null;
  audioContext = null;
  audioSource = null;
  isListening = false;
  micButton.textContent = "마이크 시작";
  micButton.classList.remove("is-listening");
  resetBandMotion();
  cancelAnimationFrame(animationId);
  drawFrame();
}

micButton.addEventListener("click", async () => {
  if (isListening) {
    stopMic();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    micButton.textContent = "지원 안됨";
    return;
  }

  try {
    micButton.textContent = "허용 대기";
    await startMic();
  } catch (error) {
    console.error(error);
    micButton.textContent = "권한 필요";
    setTimeout(() => {
      if (!isListening) {
        micButton.textContent = "마이크 시작";
      }
    }, 1400);
  }
});

window.addEventListener("resize", resizeCanvas);
setupColorControls();
setupWidthControls();
setupGlobalControls();
resizeCanvas();
drawFrame();
