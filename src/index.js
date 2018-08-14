import { curry, is, path, prop } from 'ramda';

import './main.css';
import { GainControl } from './components/gain-control';
import { switchAll } from 'rxjs/operators';

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

const handleMidiEvent = curry(
  (oscillator, gainControl, { data: [status, keyNumber, velocity] }) => {
    const noteOnMask = 0x90; // any channel;
    const noteOffMask = 0x80; // any channel;
    const pitchChangeMask = 0xe0;
    const maxVelocity = 0xef;

    if (noteOnMask & status) {
      // A4 = 5 * 12 octaves up -3 semitones
      oscillator.frequency.setValueAtTime(keyNumberToPitch(57, 440, keyNumber), 0);
      gainControl.setGain(velocity / maxVelocity);
    } else if (noteOffMask & status) {
      gainControl.setGain(0);
    }
  }
);

const createControllerSelector = curry((oscillator, gainControl, controllers) => {
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
        device.onmidimessage = handleMidiEvent(oscillator, gainControl);
      } else {
        device.onmidimessage = null;
      }
    });
  };
  document.body.appendChild(selectElement);
});

const initialize = () => {
  const context = new AudioContext();
  const oscillator = new OscillatorNode(context);
  const amp = new GainControl(context, { gain: 0.8 });

  context
    .suspend()
    .then(() => {
      oscillator.connect(amp.audioNode).connect(context.destination);

      const element = document.createElement('button');
      let itsOn = false;
      element.innerHTML = 'make some noise';
      element.classList.add('oscillator');
      element.addEventListener('click', () => {
        if ((itsOn = !itsOn)) {
          context.resume();
          element.innerHTML = 'cut that out';
        } else {
          context.suspend();
          element.innerHTML = 'make some noise';
        }
      });

      document.body.appendChild(element);
      document.body.appendChild(amp.htmlElement);
      oscillator.start();
    })
    .then(getMidiControllers)
    .then(createControllerSelector(oscillator, amp));
};

document.addEventListener(
  'readystatechange',
  ({ target }) => target.readyState === 'complete' && initialize()
);
