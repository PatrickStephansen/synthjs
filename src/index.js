import { clamp, cond, curry, is, minBy, path, pipe, prop, propEq, sortBy, when } from 'ramda';

import './main.css';
import { GainControl } from './components/gain-control';

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

const envelopeCanvasOptions = {
  height: 200,
  width: 500,
  maxAmplitude: 1,
  totalSeconds: 5,
  handleRadius: 4,
  minSustainWidth: 50
};
const drawEnvelopeState = (
  { height, width, maxAmplitude, totalSeconds, handleRadius },
  context,
  { a, d, s, r }
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
  oscillatorPool.find(osc => !osc.key) || oscillatorPool.reduce(minBy(o => o.lastReleased));
const getOscillatorForKey = (oscillatorPool, keyNumber) =>
  sortBy(o => -o.lastPressed, oscillatorPool).find(o => o.key === keyNumber);

const oscillateOnMidiEvent = curry(
  (oscillatorPool, { a, d, s, r }, { data: [status, keyNumber, velocity] }) => {
    const noteOnMask = 0x90; // any channel;
    const maxVelocity = 127;
    console.log('midi event:', { status, keyNumber, velocity });
    if (noteOnMask & status) {
      let oscillatorEntry;

      if (velocity <= 0) {
        oscillatorEntry = getOscillatorForKey(oscillatorPool, keyNumber);
        if (!oscillatorEntry) {
          console.count('no oscillator to fee for key ' + keyNumber);
          return;
        }
        oscillatorEntry.freeTimer = setTimeout(() => {
          oscillatorEntry.key = null;
          oscillatorEntry.lastReleased = Date.now();
        }, r.time * 1000);
        oscillatorEntry.amp.endEnvelope({ r });
      } else {
        const scalingFactor = velocity / maxVelocity / oscillatorPool.length;
        oscillatorEntry = getFirstIdleOscillator(oscillatorPool);
        oscillatorEntry.lastPressed = Date.now();
        oscillatorEntry.amp.startEnvelope({ a, d, s }, scalingFactor);
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
  document.body.appendChild(label);
  document.body.appendChild(selectElement);
});

const addRelativeElementCoords = curry((element, event) => {
  const elementLocation = element.getBoundingClientRect();
  event.relativeX = event.clientX - elementLocation.x;
  event.relativeY = event.clientY - elementLocation.y;
  return event;
});

const initialize = () => {
  const context = new AudioContext();
  const keyBoardOscillatorPool = [];
  const oscillatorPoolSize = 10;
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

      document.body.appendChild(masterOnButton);

      const waveforms = ['sine', 'triangle', 'sawtooth', 'square'];

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
      document.body.appendChild(waveformLabel);
      document.body.appendChild(waveformSelector);

      const envelopeElement = document.createElement('canvas');
      envelopeElement.id = 'midiInputGainEnvelope';
      const envelopeLabel = document.createElement('label');
      envelopeLabel.htmlFor = envelopeElement.id;
      envelopeElement.width = envelopeCanvasOptions.width;
      envelopeElement.height = envelopeCanvasOptions.height;
      const envelopeContext = envelopeElement.getContext('2d');

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
                drawEnvelopeState(envelopeCanvasOptions, envelopeContext, envelopeState)
              )
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
              drawEnvelopeState(envelopeCanvasOptions, envelopeContext, envelopeState)
            )
        )
      );
      window.addEventListener('mouseup', handleReleased);
      drawEnvelopeState(envelopeCanvasOptions, envelopeContext, envelopeState);
      document.body.appendChild(envelopeLabel);
      document.body.appendChild(envelopeElement);

      keyBoardOscillatorPool.forEach(({ amp }) => document.body.appendChild(amp.htmlElement));

      keyBoardOscillatorPool.forEach(({ oscillator }) => oscillator.start());
    })
    .then(getMidiControllers)
    .then(createControllerSelector(oscillateOnMidiEvent(keyBoardOscillatorPool, envelopeState)));
};

document.addEventListener(
  'readystatechange',
  ({ target }) => target.readyState === 'complete' && initialize()
);
