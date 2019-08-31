import {
  clamp,
  cond,
  curry,
  filter,
  is,
  minBy,
  path,
  pipe,
  prop,
  propEq,
  sortBy,
  when
} from 'ramda';

import './main.css';
import { GainControl } from './components/gain-control';

const maxBend = 2; // semitones
let pitchOffset = 0;
const getMasterControlsSection = () => document.getElementById('master-controls');
const getOscillatorControlsSection = () => document.getElementById('oscillator-controls');

// this is not a full implementation, just good enough for the calls currently used
const polyfillHitRegions = () => {
  let hitRegions = [];
  let isFirstCall = true;
  CanvasRenderingContext2D.prototype.addHitRegion =
    CanvasRenderingContext2D.prototype.addHitRegion ||
    function(options) {
      hitRegions.push(options);
      if (!isFirstCall) return;
      isFirstCall = false;
      this.canvas.addEventListener('mousedown', event => {
        for (let region of hitRegions) {
          if (this.isPointInPath(region.path, event.offsetX, event.offsetY)) {
            event.region = region.id;
          }
        }
      });
    };
  CanvasRenderingContext2D.prototype.clearHitRegions =
    CanvasRenderingContext2D.prototype.clearHitRegions ||
    function() {
      hitRegions = [];
    };
};

const getMidiControllers = () => {
  const requestMidiAccess = path(['navigator', 'requestMIDIAccess'], window);
  if (!is(Function, requestMidiAccess)) {
    throw new Error('No midi support. This app requires a Chromium-based browser to input midi.');
  }
  return window.navigator.requestMIDIAccess().then(access => {
    const midiInputsIterator = access.inputs.values();
    const controllers = [];
    for (
      let input = midiInputsIterator.next();
      !prop('done', input);
      input = midiInputsIterator.next()
    ) {
      controllers.push(input.value);
    }
    if (!controllers.length) {
      throw new Error(
        'No midi ports found. You need to plug in a midi controller or start an app that outputs midi signals to make any sounds.'
      );
    }
    return controllers;
  }, console.error);
};
const anyMoving = envelopeState =>
  envelopeState.a.moving ||
  envelopeState.d.moving ||
  envelopeState.s.moving ||
  envelopeState.r.moving ||
  false;

const stopMoving = envelopeState => {
  for (let point in envelopeState) envelopeState[point].moving = false;
};

const keyNumberToPitch = curry((referenceKey, referencePitch, keyNumber) => {
  return referencePitch * 2 ** ((keyNumber - referenceKey) / 12);
});

const keyNumberToNote = keyNumber =>
  ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][keyNumber % 12] +
  (Math.floor(keyNumber / 12) - 1);

const envelopeCanvasOptions = {
  height: 450,
  width: 1300,
  maxAmplitude: 1,
  totalSeconds: 5,
  handleRadius: 6,
  minSustainWidth: 50,
  noteFontSize: 16
};
let animations = [];

const drawNoteAnimations = (
  animations,
  { height, totalSeconds, amplitudePerPixel, secondsPerPixel, noteFontSize },
  context,
  { r },
  time
) => {
  context.save();
  context.fillStyle = 'rgba(0, 0, 0, 0.6)';
  context.textAlign = 'center';
  context.textBaseline = 'ideographic';
  context.font = `${noteFontSize}px sans-serif`;
  const noteTextWidth = context.measureText('E#-1').width * 0.6;
  const filterActive = filter(a => a.startTime <= time && time <= a.endTime);
  const activeAnimations = filterActive(animations);
  activeAnimations.forEach(animation =>
    filterActive(animation.phases).forEach(animationPhase => {
      const curveStartTime =
        animationPhase.curveStartTime > 0
          ? animationPhase.curveStartTime
          : -totalSeconds * 1000 - animationPhase.curveStartTime + animationPhase.startTime;
      let timeOnCanvas = (time - curveStartTime) / 1000 / secondsPerPixel;
      if (animationPhase.phase === 'sustain') {
        timeOnCanvas = Math.min(timeOnCanvas, (totalSeconds - r.time) / secondsPerPixel);
      }
      const amplitudeOnCanvas =
        height - animationPhase.curve((time - animationPhase.startTime) / 1000) / amplitudePerPixel;
      animationPhase.timeOnCanvas = timeOnCanvas;
      animationPhase.amplitudeOnCanvas = amplitudeOnCanvas;
      context.beginPath();
      context.arc(timeOnCanvas, amplitudeOnCanvas, noteTextWidth, 0, 2 * Math.PI);
      context.fill();
    })
  );
  context.fillStyle = 'rgba(255, 255, 255, 06)';
  activeAnimations.forEach(animation =>
    filterActive(animation.phases).forEach(animationPhase => {
      context.fillText(
        animation.noteName,
        animationPhase.timeOnCanvas,
        animationPhase.amplitudeOnCanvas + 0.5 * noteFontSize
      );
    })
  );

  context.restore();
};

const showParams = (paramsElement, { a, d, s, r }) => {
  paramsElement.innerText = `Attack:
  time: ${a.time}
  amplitude: ${a.amplitude}
Decay:
  time: ${d.time}
Sustain:
  amplitude: ${s.amplitude}
Release:
  time: ${r.time}`;
};
const drawEnvelopeState = (
  { height, width, maxAmplitude, totalSeconds, handleRadius, noteFontSize },
  context,
  { a, d, s, r },
  paramsElement
) => {
  const amplitudePerPixel = maxAmplitude / height;
  const secondsPerPixel = totalSeconds / width;
  const drawLineTo = (path, time, amplitude) =>
    path.lineTo(time / secondsPerPixel, height - amplitude / amplitudePerPixel);
  context.lineJoin = 'miter';
  context.clearRect(0, 0, width, height);
  context.clearHitRegions();
  const lines = new Path2D();
  lines.moveTo(0, height);
  drawLineTo(lines, a.time, a.amplitude);
  drawLineTo(lines, a.time + d.time, s.amplitude);
  drawLineTo(lines, totalSeconds - r.time, s.amplitude);
  drawLineTo(lines, totalSeconds, 0);
  context.stroke(lines);
  const attackPoint = new Path2D();
  attackPoint.arc(
    a.time / secondsPerPixel,
    height - a.amplitude / amplitudePerPixel,
    handleRadius,
    0,
    2 * Math.PI,
    false
  );
  context.addHitRegion({ id: 'attack', path: attackPoint });
  context.fill(attackPoint);
  const decayPoint = new Path2D();
  decayPoint.arc(
    (a.time + d.time) / secondsPerPixel,
    height - s.amplitude / amplitudePerPixel,
    handleRadius,
    0,
    2 * Math.PI,
    false
  );
  context.addHitRegion({ id: 'decay', path: decayPoint });
  context.fill(decayPoint);
  const releasePoint = new Path2D();
  releasePoint.arc(
    (totalSeconds - r.time) / secondsPerPixel,
    height - s.amplitude / amplitudePerPixel,
    handleRadius,
    0,
    2 * Math.PI,
    false
  );
  context.addHitRegion({ id: 'release', path: releasePoint });
  context.fill(releasePoint);

  showParams(paramsElement, { a, d, s, r });

  const time = Date.now();
  animations = animations.filter(a => a.endTime > time);
  drawNoteAnimations(
    animations,
    { height, width, maxAmplitude, totalSeconds, amplitudePerPixel, secondsPerPixel, noteFontSize },
    context,
    { r },
    time
  );

  const activeAnimations = animations.filter(a => a.startTime <= time && time <= a.endTime);
  if (activeAnimations.length) {
    requestAnimationFrame(() =>
      drawEnvelopeState(
        { height, width, maxAmplitude, totalSeconds, handleRadius, noteFontSize },
        context,
        { a, d, s, r },
        paramsElement
      )
    );
  }
};

const startAttackAnimation = ({ a, d, s }, noteName) => {
  const now = Date.now();
  return {
    noteName,
    startTime: now,
    endTime: now + 60000,
    phases: [
      {
        phase: 'attack',
        curve: t => (a.amplitude / a.time) * t,
        startTime: now,
        curveStartTime: now,
        endTime: now + a.time * 1000
      },
      {
        // a.amplitude = c
        // s.amplitude = m*(d.time) + c
        // s.amplitude = m*(d.time) + a.amplitude
        // m = (s.amplitude -a.amplitude )/d.time
        // amplitude = t*((s.amplitude -a.amplitude )/d.time) + a.amplitude
        phase: 'decay',
        curve: t => t * ((s.amplitude - a.amplitude) / d.time) + a.amplitude,
        startTime: now + a.time * 1000,
        curveStartTime: now,
        endTime: now + 1000 * (a.time + d.time)
      },
      {
        phase: 'sustain',
        curve: () => s.amplitude,
        startTime: now + (a.time + d.time) * 1000,
        curveStartTime: now,
        // normally ended by cancellation
        // safety net prevents rendering forever
        endTime: now + 60000
      }
    ]
  };
};

const startReleaseAnimation = ({ s, r }, noteName) => {
  const now = Date.now();
  return {
    noteName,
    startTime: now,
    endTime: now + r.time * 1000,
    phases: [
      {
        phase: 'release',
        curve: t => (-s.amplitude / r.time) * t + s.amplitude,
        startTime: now,
        curveStartTime: -r.time * 1000,
        endTime: now + r.time * 1000
      }
    ]
  };
};

const handleEnvelopePointMove = curry(
  ({ height, width, maxAmplitude, totalSeconds, minSustainWidth }, { a, d, s, r }, event) => {
    const amplitudePerPixel = maxAmplitude / height;
    const secondsPerPixel = totalSeconds / width;
    if (a.moving) {
      const envelopePoint = a;
      envelopePoint.amplitude = clamp(
        0,
        maxAmplitude,
        maxAmplitude - event.relativeY * amplitudePerPixel
      );
      envelopePoint.time = clamp(
        0,
        totalSeconds - minSustainWidth * secondsPerPixel - (d.time + r.time),
        event.relativeX * secondsPerPixel
      );
    }
    if (d.moving) {
      s.amplitude = clamp(0, maxAmplitude, maxAmplitude - event.relativeY * amplitudePerPixel);
      d.time = clamp(
        0,
        totalSeconds - minSustainWidth * secondsPerPixel - (a.time + r.time),
        event.relativeX * secondsPerPixel - a.time
      );
    }
    if (r.moving) {
      s.amplitude = clamp(0, maxAmplitude, maxAmplitude - event.relativeY * amplitudePerPixel);
      r.time = clamp(
        0,
        totalSeconds - minSustainWidth * secondsPerPixel - (a.time + d.time),
        (width - event.relativeX) * secondsPerPixel
      );
    }
  }
);

const getFirstIdleOscillator = oscillatorPool =>
  oscillatorPool.find(osc => !osc.key) ||
  (oscillatorPool.some(osc => osc.isDecaying) &&
    oscillatorPool.filter(osc => osc.isDecaying).reduce(minBy(o => o.lastReleased))) ||
  oscillatorPool.reduce(minBy(o => o.lastReleased));
const getOscillatorForKey = (oscillatorPool, keyNumber) =>
  sortBy(o => -o.lastPressed, oscillatorPool).find(o => o.key === keyNumber && !o.isDecaying);

const oscillateOnMidiEvent = curry(
  (oscillatorPool, { a, d, s, r }, { data: [status, keyNumber, velocity] }) => {
    const noteRangeStart = 128;
    const noteRangeEnd = 159; // any channel, on or off
    const maxVelocity = 127;
    const pitchBendStart = 224;
    const pitchBendEnd = 239;
    if (noteRangeStart <= status && status <= noteRangeEnd) {
      let oscillatorEntry;

      const noteName = keyNumberToNote(keyNumber);
      if (velocity <= 0 || status <= 143) {
        oscillatorEntry = getOscillatorForKey(oscillatorPool, keyNumber);
        if (!oscillatorEntry) {
          return;
        }
        oscillatorEntry.freeTimer = setTimeout(() => {
          oscillatorEntry.key = null;
          oscillatorEntry.isDecaying = false;
        }, r.time * 1000);
        oscillatorEntry.lastReleased = Date.now();
        oscillatorEntry.isDecaying = true;

        animations.splice(
          animations.findIndex(
            a => a.phases.some(p => p.phase === 'attack') && a.noteName === noteName
          ),
          1
        );
        animations.push(startReleaseAnimation({ s, r }, noteName));

        oscillatorEntry.amp.endEnvelope({ r }, noteName);
      } else {
        const scalingFactor = velocity / maxVelocity;
        oscillatorEntry = getFirstIdleOscillator(oscillatorPool);
        oscillatorEntry.lastPressed = Date.now();
        oscillatorEntry.isDecaying = false;

        // impure
        animations.push(startAttackAnimation({ a, d, s }, noteName));
        oscillatorEntry.amp.startEnvelope({ a, d, s }, scalingFactor, noteName);
        // if the oscillator hasn't been freed and is being reused, cancel the scheduled freeing
        if (oscillatorEntry.key !== null) {
          clearTimeout(oscillatorEntry.freeTimer);
        }
      }
      // some controllers send note on with 0 velocity instead of note off events
      oscillatorEntry.key = keyNumber;
      // A4 = 12 * 5 octaves up -3 semitones
      oscillatorEntry.oscillator.frequency.setValueAtTime(
        keyNumberToPitch(57, 440, keyNumber + pitchOffset),
        oscillatorEntry.oscillator.context.currentTime
      );
    }
    if (pitchBendStart <= status && status <= pitchBendEnd) {
      pitchOffset = ((velocity - 64) / 64) * maxBend;
      oscillatorPool.forEach(oscillatorEntry => {
        if (!oscillatorEntry.key) return;
        oscillatorEntry.oscillator.frequency.setValueAtTime(
          keyNumberToPitch(57, 440, oscillatorEntry.key + pitchOffset),
          oscillatorEntry.oscillator.context.currentTime
        );
      });
    }
  }
);

const selectControllerByIndex = (controllers, selectOptions, onMessage, selectedIndex) => {
  controllers.forEach((device, index) => {
    if (index == selectedIndex) {
      localStorage.setItem('midi-controller-index', selectedIndex);
      if (selectOptions[index]) {
        selectOptions[index].selected = true;
      }
      device.onmidimessage = onMessage;
    } else {
      device.onmidimessage = null;
    }
  });
};

const createControllerSelector = curry((onMessage, controllers) => {
  const selectorContainer = document.createElement('div');
  selectorContainer.classList.add('control-group');
  const selectElement = document.createElement('select');
  selectElement.id = 'midiInputSelect';
  const label = document.createElement('label');
  label.htmlFor = selectElement.id;
  label.innerText = 'midi input';
  controllers.forEach((controller, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.innerText = `${controller.manufacturer} ${controller.name}`;
    selectElement.options.add(option);
  });
  selectElement.onchange = e => {
    selectControllerByIndex(controllers, selectElement.options, onMessage, e.target.value);
  };
  if (controllers.length && localStorage.getItem('midi-controller-index') <= controllers.length) {
    selectControllerByIndex(
      controllers,
      selectElement.options,
      onMessage,
      localStorage.getItem('midi-controller-index') || 0
    );
  }
  selectorContainer.appendChild(label);
  selectorContainer.appendChild(selectElement);
  getMasterControlsSection().appendChild(selectorContainer);
  return controllers;
});

const addRelativeElementCoords = curry((element, event) => {
  const elementLocation = element.getBoundingClientRect();
  event.relativeX = event.clientX - elementLocation.x;
  event.relativeY = event.clientY - elementLocation.y;
  return event;
});

let envelopeContext, envelopParamsElement;

const initialize = () => {
  polyfillHitRegions();

  const context = new AudioContext();
  const keyBoardOscillatorPool = [];
  const oscillatorPoolSize = 30;

  for (let index = 0; index < oscillatorPoolSize; index++) {
    keyBoardOscillatorPool.push({
      oscillator: new OscillatorNode(context),
      amp: new GainControl(context, { gain: 0 })
    });
  }
  const envelopeState = {
    a: { time: 0.01, amplitude: 1 },
    d: { time: 0.25 },
    s: { amplitude: 0.25 },
    r: { time: 1 }
  };
  const masterGain = new GainControl(context, { gain: 0.3 });
  masterGain.audioNode.connect(context.destination);

  context
    .suspend()
    .then(() => {
      keyBoardOscillatorPool.forEach(({ oscillator, amp }) =>
        oscillator.connect(amp.audioNode).connect(masterGain.audioNode)
      );

      const masterOnButton = document.createElement('button');
      let itsOn = false;
      masterOnButton.innerHTML = 'make some noise';
      masterOnButton.title =
        'Enable sound. Some browsers have autoplay policies that stop sound from being enabled immediately when a page loads.';
      masterOnButton.addEventListener('click', () => {
        if ((itsOn = !itsOn)) {
          context.resume();
          masterOnButton.innerHTML = 'cut that out';
          masterOnButton.title = 'Mute sound';
        } else {
          context.suspend();
          masterOnButton.title = 'Enable sound.';
          masterOnButton.innerHTML = 'make some noise';
        }
      });

      getMasterControlsSection().appendChild(masterOnButton);

      const waveforms = ['sine', 'triangle', 'square', 'sawtooth'];

      const waveformsContainer = document.createElement('div');
      waveformsContainer.classList.add('control-group');
      const waveformSelector = document.createElement('select');
      waveformSelector.id = 'waveform-selector';
      waveforms.forEach(waveform => {
        const option = document.createElement('option');
        option.value = waveform;
        option.innerText = `${waveform}`;
        waveformSelector.options.add(option);
      });
      waveformSelector.onchange = event =>
        keyBoardOscillatorPool.forEach(({ oscillator }) => (oscillator.type = event.target.value));
      const waveformLabel = document.createElement('label');
      waveformLabel.htmlFor = waveformSelector.id;
      waveformLabel.innerText = 'waveform';
      waveformsContainer.appendChild(waveformLabel);
      waveformsContainer.appendChild(waveformSelector);
      getOscillatorControlsSection().appendChild(waveformsContainer);
      getMasterControlsSection().appendChild(masterGain.htmlElement);

      const controlsContainer = document.createElement('div');
      controlsContainer.classList.add('flex-controls');

      const envelopeContainer = document.createElement('div');
      const envelopHeader = document.createElement('h3');
      envelopHeader.innerText = 'Gain envelope';
      envelopeContainer.appendChild(envelopHeader);
      const envelopeElement = document.createElement('canvas');
      envelopeElement.id = 'midiInputGainEnvelope';
      const envelopEventListenerElement = document.createElement('div');
      envelopEventListenerElement.id = 'gainEnvelopeListener';
      const envelopeLabel = document.createElement('label');
      envelopeLabel.htmlFor = envelopeElement.id;
      envelopeElement.width = envelopeCanvasOptions.width;
      envelopeElement.height = envelopeCanvasOptions.height;
      envelopeContext = envelopeElement.getContext('2d');
      envelopParamsElement = document.createElement('pre');

      const isRegion = propEq('region');

      envelopEventListenerElement.addEventListener(
        'mousedown',
        cond([
          [
            isRegion('attack'),
            () => {
              envelopeState.a.moving = true;
              envelopeState.d.moving = envelopeState.r.moving = false;
            }
          ],
          [
            isRegion('decay'),
            () => {
              envelopeState.d.moving = true;
              envelopeState.a.moving = envelopeState.r.moving = false;
            }
          ],
          [
            isRegion('release'),
            () => {
              envelopeState.r.moving = true;
              envelopeState.a.moving = envelopeState.d.moving = false;
            }
          ]
        ])
      );
      window.addEventListener(
        'mousemove',
        when(
          () => anyMoving(envelopeState),
          pipe(
            addRelativeElementCoords(envelopEventListenerElement),
            handleEnvelopePointMove(envelopeCanvasOptions, envelopeState),
            () =>
              requestAnimationFrame(() =>
                drawEnvelopeState(
                  envelopeCanvasOptions,
                  envelopeContext,
                  envelopeState,
                  envelopParamsElement
                )
              ),
            () => window.getSelection().empty()
          )
        )
      );

      const handleReleased = when(
        () => anyMoving(envelopeState),
        pipe(
          addRelativeElementCoords(envelopEventListenerElement),
          handleEnvelopePointMove(envelopeCanvasOptions, envelopeState),
          () => stopMoving(envelopeState),
          () =>
            requestAnimationFrame(() =>
              drawEnvelopeState(
                envelopeCanvasOptions,
                envelopeContext,
                envelopeState,
                envelopParamsElement
              )
            )
        )
      );
      window.addEventListener('mouseup', handleReleased);
      drawEnvelopeState(
        envelopeCanvasOptions,
        envelopeContext,
        envelopeState,
        envelopParamsElement
      );
      envelopEventListenerElement.appendChild(envelopeElement);
      envelopeContainer.appendChild(envelopeLabel);
      envelopeContainer.appendChild(envelopEventListenerElement);
      envelopeContainer.appendChild(envelopParamsElement);

      const oscillatorPoolContainer = document.createElement('div');
      const oscillatorPoolHeader = document.createElement('h3');
      oscillatorPoolHeader.innerText = 'Oscillator pool';
      oscillatorPoolContainer.appendChild(oscillatorPoolHeader);
      const oscillatorsStack = document.createElement('div');
      oscillatorsStack.classList.add('flex-controls-vertical');

      keyBoardOscillatorPool.forEach(({ amp }) => oscillatorsStack.appendChild(amp.htmlElement));
      oscillatorPoolContainer.appendChild(oscillatorsStack);
      controlsContainer.appendChild(envelopeContainer);
      controlsContainer.appendChild(oscillatorPoolContainer);
      getOscillatorControlsSection().appendChild(controlsContainer);

      keyBoardOscillatorPool.forEach(({ oscillator }) => oscillator.start());
    })
    .then(getMidiControllers)
    .then(
      createControllerSelector(
        pipe(
          oscillateOnMidiEvent(keyBoardOscillatorPool, envelopeState),
          () =>
            drawEnvelopeState(
              envelopeCanvasOptions,
              envelopeContext,
              envelopeState,
              envelopParamsElement
            )
        )
      )
    )
    .catch(error => {
      const errorList = document.getElementById('errors');
      const errorItem = document.createElement('p');
      errorItem.textContent = error.message;
      errorList.appendChild(errorItem);
    });
};

document.addEventListener(
  'readystatechange',
  ({ target }) => target.readyState === 'complete' && initialize()
);
