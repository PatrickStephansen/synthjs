import { NumericInputControl } from './numeric-input-control';
import { distinctUntilChanged } from 'rxjs/operators';

export class GainControl {
  constructor(audioContext, options) {
    this.subscriptions = [];
    this.audioNode = new GainNode(audioContext, options);
    this.audioContext = audioContext;
    this.htmlElement = document.createElement('div');
    this.htmlElement.classList.add('gain-control');
    this.inputControl = new NumericInputControl({
      min: 0,
      max: 1,
      step: 0.001,
      value: this.audioNode.gain.value,
      label: 'Gain'
    });
    this.htmlElement.appendChild(this.inputControl.htmlElement);

    this.subscriptions.push(
      this.inputControl.change$.pipe(distinctUntilChanged()).subscribe(newGain => {
        this.audioNode.gain.value = newGain;
      })
    );
  }

  setGain(newGain) {
    this.inputControl.setValue(newGain);
    this.audioNode.gain.cancelScheduledValues(this.audioNode.context.currentTime);
    this.audioNode.gain.value = this.inputControl.value;
  }

  startEnvelope({ a, d, s }, amplitudeScalingFactor) {
    this.audioNode.gain.cancelScheduledValues(this.audioNode.context.currentTime);
    this.audioNode.gain.setValueAtTime(0, this.audioNode.context.currentTime);
    this.inputControl.setValue(a.amplitude * amplitudeScalingFactor);

    this.audioNode.gain.linearRampToValueAtTime(
      a.amplitude * amplitudeScalingFactor,
      this.audioNode.context.currentTime + a.time
    );
  }

  endEnvelope({ r }) {
    const currentGain = this.audioNode.gain.value;
    this.audioNode.gain.cancelScheduledValues(this.audioNode.context.currentTime);
    this.audioNode.gain.setValueAtTime(currentGain, this.audioNode.context.currentTime);

    this.audioNode.gain.linearRampToValueAtTime(
      0,
      this.audioNode.context.currentTime + r.time
    );
    this.inputControl.setValue(0);
  }
}
