import { curry, is, path, prop } from 'ramda';

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

const keyNumberToPitch = curry((referenceKey, referencePitch, keyNumber) => {
  return referencePitch * 2 ** ((keyNumber - referenceKey) / 12);
});

const envelopeCanvasOptions = {
  height: 200,
  width: 500,
  maxAmplitude: 127,
  totalSeconds: 5,
  sustainWidthFactor: 0.5,
  margin: 5,
  scaleWidth: 10
};
const drawEnvelopeState = (
  { height, width, maxAmplitude, totalSeconds, sustainWidthFactor, margin, scaleWidth },
  context,
  { a, d, s, r }
) => {
  const amplitudePerPixel = maxAmplitude / height;
  const secondsPerPixel = totalSeconds / width;
  const drawLineTo = (time, amplitude) =>
    context.lineTo(
      scaleWidth + margin + time / secondsPerPixel,
      margin + height - amplitude / amplitudePerPixel
    );
  context.lineJoin = 'miter';
  context.clearRect(margin, margin, width, height);
  context.beginPath();
  context.moveTo(scaleWidth + margin, height + margin);
  drawLineTo(a.time, a.amplitude);
  drawLineTo(a.time + d.time, s.amplitude);
  drawLineTo(a.time + d.time + width * sustainWidthFactor * secondsPerPixel, s.amplitude);
  drawLineTo(a.time + d.time + width * sustainWidthFactor * secondsPerPixel + r.time, 0);
  context.stroke();
};

const attachEnvelopeControls = (
  { height, width, maxAmplitude, totalSeconds, sustainWidthFactor, margin, scaleWidth },
  { context, attackTimeInput },
  { a, d, s, r }
) => {
  context.addHitRegion({ control: attackTimeInput });
  context.drawFocusRingIfNeeded(attackTimeInput);
  // continue trying with https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API
};

const getFirstIdleOscillator = oscillatorPool =>
  oscillatorPool.find(osc => !osc.key) || oscillatorPool[0];
const getOscillatorForKey = (oscillatorPool, keyNumber) =>
  oscillatorPool.find(o => o.key === keyNumber);

const oscillateOnMidiEvent = curry((oscillatorPool, { data: [status, keyNumber, velocity] }) => {
  const noteOnMask = 0x90; // any channel;
  const noteOffMask = 0x80; // any channel;
  const pitchChangeMask = 0xe0;
  const maxVelocity = 0xef;
  console.log('midi event:', { status, keyNumber, velocity });
  if (noteOnMask & status) {
    // some controllers send note on with 0 velocity instead of note off events
    const oscillatorEntry =
      getOscillatorForKey(oscillatorPool, keyNumber) || getFirstIdleOscillator(oscillatorPool);
    oscillatorEntry.key = keyNumber;
    // A4 = 12 * 5 octaves up -3 semitones
    oscillatorEntry.oscillator.frequency.setValueAtTime(keyNumberToPitch(57, 440, keyNumber), 0);
    oscillatorEntry.amp.setGain(velocity / maxVelocity / oscillatorPool.length);
    if (velocity === 0) {
      oscillatorEntry.key = null;
    }
  } else if (noteOffMask & status) {
    const oscillatorEntry = getOscillatorForKey(oscillatorPool, keyNumber);
    oscillatorEntry.key = null;
    oscillatorEntry.amp.setGain(0);
  }
});

const createControllerSelector = curry((oscillatorPool, controllers) => {
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
        device.onmidimessage = oscillateOnMidiEvent(oscillatorPool);
      } else {
        device.onmidimessage = null;
      }
    });
  };
  document.body.appendChild(label);
  document.body.appendChild(selectElement);
});

const initialize = () => {
  const context = new AudioContext();
  const keyBoardOscillatorPool = [];
  for (let index = 0; index < 10; index++) {
    keyBoardOscillatorPool.push({
      oscillator: new OscillatorNode(context),
      amp: new GainControl(context, { gain: 0 })
    });
  }

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
      envelopeElement.width =
        envelopeCanvasOptions.width +
        2 * envelopeCanvasOptions.margin +
        envelopeCanvasOptions.scaleWidth;
      envelopeElement.height =
        envelopeCanvasOptions.height +
        2 * envelopeCanvasOptions.margin +
        envelopeCanvasOptions.scaleWidth;
      envelopeElement.innerHTML = `canvas not supported <input type="number" id="attackTime">`;
      const envelopeContext = envelopeElement.getContext('2d');
      const envelopeState = {
        a: { time: 0.5, amplitude: 127 },
        d: { time: 1 },
        s: { amplitude: 90 },
        r: { time: 1 }
      };
      drawEnvelopeState(envelopeCanvasOptions, envelopeContext, envelopeState);
      document.body.appendChild(envelopeLabel);
      document.body.appendChild(envelopeElement);

      keyBoardOscillatorPool.forEach(({ amp }) => document.body.appendChild(amp.htmlElement));

      keyBoardOscillatorPool.forEach(({ oscillator }) => oscillator.start());
    })
    .then(getMidiControllers)
    .then(createControllerSelector(keyBoardOscillatorPool));
};

document.addEventListener(
  'readystatechange',
  ({ target }) => target.readyState === 'complete' && initialize()
);
