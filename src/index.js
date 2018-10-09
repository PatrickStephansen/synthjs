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

const getMasterControlsSection = () => document.getElementById('master-controls');
const getOscillatorControlsSection = () => document.getElementById('oscillator-controls');

const getMidiControllers = () => {
  const requestMidiAccess = path(['navigator', 'requestMIDIAccess'], window);
  if (!is(Function, requestMidiAccess)) {
    throw new Error('no midi support');
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
  height: 360,
  width: 1000,
  maxAmplitude: 1,
  totalSeconds: 5,
  handleRadius: 6,
  minSustainWidth: 50,
  noteFontSize: 12
};
let animations = [];

const drawNoteAnimations = (
  animations,
  { height, width, maxAmplitude, totalSeconds, amplitudePerPixel, secondsPerPixel, noteFontSize },
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

const showParams = (containerElement, { a, d, s, r }) => {
  containerElement.innerHTML = ``;
  const paramsElement = document.createElement('pre');
  paramsElement.innerText = `Attack:
  time: ${a.time}
  amplitude: ${a.amplitude}
Decay:
  time: ${d.time}
Sustain:
  amplitude: ${s.amplitude}
Release:
  time: ${r.time}`;
  containerElement.appendChild(paramsElement);
};
const drawEnvelopeState = (
  { height, width, maxAmplitude, totalSeconds, handleRadius, noteFontSize },
  context,
  { a, d, s, r },
  paramsElement
) => {
  const amplitudePerPixel = maxAmplitude / height;
  const secondsPerPixel = totalSeconds / width;
  const drawLineTo = (time, amplitude) =>
    context.lineTo(time / secondsPerPixel, height - amplitude / amplitudePerPixel);
  context.lineJoin = 'miter';
  context.clearRect(0, 0, width, height);
  context.clearHitRegions();
  context.beginPath();
  context.moveTo(0, height);
  drawLineTo(a.time, a.amplitude);
  drawLineTo(a.time + d.time, s.amplitude);
  drawLineTo(totalSeconds - r.time, s.amplitude);
  drawLineTo(totalSeconds, 0);
  context.stroke();
  context.beginPath();
  context.arc(
    a.time / secondsPerPixel,
    height - a.amplitude / amplitudePerPixel,
    handleRadius,
    0,
    2 * Math.PI,
    false
  );
  context.addHitRegion({ id: 'attack', cursor: 'grab' });
  context.fill();
  context.beginPath();
  context.arc(
    (a.time + d.time) / secondsPerPixel,
    height - s.amplitude / amplitudePerPixel,
    handleRadius,
    0,
    2 * Math.PI,
    false
  );
  context.addHitRegion({ id: 'decay', cursor: 'grab' });
  context.fill();
  context.beginPath();
  context.arc(
    (totalSeconds - r.time) / secondsPerPixel,
    height - s.amplitude / amplitudePerPixel,
    handleRadius,
    0,
    2 * Math.PI,
    false
  );
  context.addHitRegion({ id: 'release', cursor: 'grab' });
  context.fill();

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
    console.log('midi event:', { status, keyNumber, velocity });
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
        const scalingFactor = velocity / maxVelocity / oscillatorPool.length;
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
      oscillatorEntry.oscillator.frequency.setValueAtTime(keyNumberToPitch(57, 440, keyNumber), 0);
    }
  }
);

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
    controllers.forEach((device, index) => {
      if (index == e.target.value) {
        device.onmidimessage = onMessage;
      } else {
        device.onmidimessage = null;
      }
    });
  };
  selectorContainer.appendChild(label);
  selectorContainer.appendChild(selectElement);
  getMasterControlsSection().appendChild(selectorContainer);
});

const addRelativeElementCoords = curry((element, event) => {
  const elementLocation = element.getBoundingClientRect();
  event.relativeX = event.clientX - elementLocation.x;
  event.relativeY = event.clientY - elementLocation.y;
  return event;
});

let envelopeContext, envelopParamsContainer;

const initialize = () => {
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
    a: { time: 0.5, amplitude: 1 },
    d: { time: 1 },
    s: { amplitude: 0.75 },
    r: { time: 1 }
  };

  context
    .suspend()
    .then(() => {
      keyBoardOscillatorPool.forEach(({ oscillator, amp }) =>
        oscillator.connect(amp.audioNode).connect(context.destination)
      );

      const masterOnButton = document.createElement('button');
      let itsOn = false;
      masterOnButton.innerHTML = 'make some noise';
      masterOnButton.addEventListener('click', () => {
        if ((itsOn = !itsOn)) {
          context.resume();
          masterOnButton.innerHTML = 'cut that out';
        } else {
          context.suspend();
          masterOnButton.innerHTML = 'make some noise';
        }
      });

      getMasterControlsSection().appendChild(masterOnButton);

      const waveforms = ['sine', 'triangle', 'sawtooth', 'square'];

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

      const controlsContainer = document.createElement('div');
      controlsContainer.classList.add('flex-controls');

      const envelopeContainer = document.createElement('div');
      const envelopHeader = document.createElement('h3');
      envelopHeader.innerText = 'Gain envelope';
      envelopeContainer.appendChild(envelopHeader);
      const envelopeElement = document.createElement('canvas');
      envelopeElement.id = 'midiInputGainEnvelope';
      const envelopeLabel = document.createElement('label');
      envelopeLabel.htmlFor = envelopeElement.id;
      envelopeElement.width = envelopeCanvasOptions.width;
      envelopeElement.height = envelopeCanvasOptions.height;
      envelopeContext = envelopeElement.getContext('2d');
      envelopParamsContainer = document.createElement('div');

      const isRegion = propEq('region');

      envelopeElement.addEventListener(
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
            addRelativeElementCoords(envelopeElement),
            handleEnvelopePointMove(envelopeCanvasOptions, envelopeState),
            () =>
              requestAnimationFrame(() =>
                drawEnvelopeState(
                  envelopeCanvasOptions,
                  envelopeContext,
                  envelopeState,
                  envelopParamsContainer
                )
              ),
            () => window.getSelection().empty()
          )
        )
      );

      const handleReleased = when(
        () => anyMoving(envelopeState),
        pipe(
          addRelativeElementCoords(envelopeElement),
          handleEnvelopePointMove(envelopeCanvasOptions, envelopeState),
          () => stopMoving(envelopeState),
          () =>
            requestAnimationFrame(() =>
              drawEnvelopeState(
                envelopeCanvasOptions,
                envelopeContext,
                envelopeState,
                envelopParamsContainer
              )
            )
        )
      );
      window.addEventListener('mouseup', handleReleased);
      drawEnvelopeState(
        envelopeCanvasOptions,
        envelopeContext,
        envelopeState,
        envelopParamsContainer
      );
      envelopeContainer.appendChild(envelopeLabel);
      envelopeContainer.appendChild(envelopeElement);
      envelopeContainer.appendChild(envelopParamsContainer);

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
              envelopParamsContainer
            )
        )
      )
    );
};

document.addEventListener(
  'readystatechange',
  ({ target }) => target.readyState === 'complete' && initialize()
);
